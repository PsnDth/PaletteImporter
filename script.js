
class ColorParser {
    constructor (colorHex) {
        this.colorHex = colorHex;
        // Can't really do a loop here since `comp` is an rvalue
        this.b = colorHex % 256;
        colorHex = Math.floor(colorHex / 256);
        this.g = colorHex % 256;
        colorHex = Math.floor(colorHex / 256);
        this.r = colorHex % 256;
        colorHex = Math.floor(colorHex / 256);
        this.a = colorHex % 256;
        colorHex = Math.floor(colorHex / 256);
    }

    static fromARGBString(colorHex) {
        return  new ColorParser(Number(colorHex));
    }

    static RGBAtoARGBHex(r, g, b, a) {
        var colorHex = 0;
        for (const comp of [a, r, g, b]) {
            colorHex *= 256;
            colorHex += comp;
        }
        return colorHex;
    }

    static toARGB(a, r, g, b) {
        return new ColorParser(ColorParser.RGBAtoARGBHex(r, g, b, a));
    }

    get rgba() {
        return [this.r, this.g, this.b, this.a,];
    }
}

class ColorDims {
    static RED = 0;
    static BLUE = 1;
    static GREEN = 2;
    static ALPHA = 3;
}

function basename(name) {
    return name.replace(/\.[^/.]+$/, "")
}

class PaletteParser {
    static GEN_FILENAME = "costumes.palettes"
    static DEFAULT_COLOR_NAME = "Untitled Palette Color"

    constructor() {
        this.colors = new Map(); // maps color to ID
        this.palettes = new Map();
        this.base_image = null;
        this.base_size = [0, 0];
     }

    async loadImage(fhandle) {
        const img_reader = new FileReader(); 
        const img_file = await fhandle.getFile();
        return new Promise((resolve, reject) => {
            img_reader.onload = (e) => resolve(e.target.result);
            img_reader.onerror = reject;
            img_reader.readAsArrayBuffer(img_file);
        });

    }

    async addBaseSprite(fhandle) {
        const base_sprite = await this.loadImage(fhandle);
        const img = await Jimp.read(base_sprite).catch((err) => {
            throw `Could not read file "${fhandle.name}" as image`;
        });
        return new Promise((resolve, reject) => {
            const pixels = img.bitmap.data;
            this.base_size = [img.bitmap.width, img.bitmap.height];
            this.base_image = new Array(img.bitmap.width * img.bitmap.height);
            img.scan(0, 0, img.bitmap.width, img.bitmap.height, (_x, _y, i) => {
                if (pixels[i+ColorDims.ALPHA] == 0) return; // Ignore transparent pixels
                const src_color = ColorParser.RGBAtoARGBHex(...pixels.slice(i, i+4));
                this.base_image[i/4] = src_color;
                if (!this.colors.has(src_color)) {
                    this.colors.set(src_color, crypto.randomUUID());
                }
            });
            resolve(this);
        });
    }

    async addPaletteSprite(fhandle) {
        const name = basename(fhandle.name);
        const pal_sprite = await this.loadImage(fhandle);
        const img =  await Jimp.read(pal_sprite);
        return new Promise((resolve, reject) => {
            if (img.bitmap.width != this.base_size[0] || img.bitmap.height != this.base_size[1])
                return reject(`Palette file "${name}" has the wrong file dimensions compared to base sprite`);

            const dst_pixels = img.bitmap.data;
            let found_err = false;
            let curr_palette = new Map();
            img.scan(0, 0, img.bitmap.width, img.bitmap.height, (x, y, i) => {
                if (found_err) return;
                if (dst_pixels[i+ColorDims.ALPHA] == 0) return; // Ignore transparent pixels
                const src_color = this.base_image[i/4];
                const dst_color = ColorParser.RGBAtoARGBHex(...dst_pixels.slice(i, i+4));
                if (src_color === undefined || !this.colors.has(src_color)) {
                    reject(`Found conflicting colour in file "${name}". @(${x}, ${y}) Trying to map transparent/unmapped colour to RGBA(${new ColorParser(dst_color).rgba})`);
                    found_err = true;
                    return;
                }
                if (curr_palette.has(src_color) && curr_palette.get(src_color) != dst_color) {
                    reject(`Found conflicting colour in file "${name}". @(${x}, ${y}) Trying to map RGBA(${new ColorParser(src_color).rgba}) to RGBA(${new ColorParser(dst_color).rgba}). Previously mapped to RGBA(${new ColorParser(curr_palette.get(src_color)).rgba})`);
                    found_err = true;
                    return;
                }
                curr_palette.set(src_color, dst_color);
            });
            if (found_err) return;
            this.palettes.set(name, curr_palette);
            resolve(this);
        });
    }
    
    async addPaletteSprites(fhandles) {
        for await (const fhandle of fhandles) {
            await this.addPaletteSprite(fhandle);
        }
    }

    async download() {
        let palette_json = {
            "export": true,
            "guid": crypto.randomUUID(),
            "colors": [],
            "maps": [],
            "imageAsset": "",
            "id": "",
            "pluginMetadata": {
                "com.fraymakers.FraymakersMetadata": {
                "version": "0.1.2"
                }
            },
            "plugins": [
                "com.fraymakers.FraymakersMetadata"
            ],
            "tags": [],
            "version": 1
        };

        function asStr(color) {
            return "0x" + color.toString(16).padStart(8, "0").toUpperCase();
        }
        let base_map_colors_json = [];
        for (const [color, color_id] of this.colors.entries()) {
            const color_str = asStr(color);
            palette_json.colors.push({
                "$id": color_id,
                "color": color_str,
                "name": PaletteParser.DEFAULT_COLOR_NAME,
                "pluginMetadata": {}
            });
            base_map_colors_json.push({
                "paletteColorId": color_id,
                "targetColor": color_str
            });
        }
        palette_json.maps.push({
            "$id": crypto.randomUUID(),
            "colors": base_map_colors_json,
            "name": "Base",
            "pluginMetadata": {
                "com.fraymakers.FraymakersMetadata": {
                    "isBase": true
                }
            },
        });
        
        for (const [name, palette] of this.palettes.entries()) {
            const palette_map = {
                "$id": crypto.randomUUID(),
                "colors": [],
                "name": name,
                "pluginMetadata": {
                    "com.fraymakers.FraymakersMetadata": {
                        "isBase": false
                    }
                }
            };
            for (const [src_color, dst_color] of palette.entries()){
                palette_map.colors.push({
                    "paletteColorId": this.colors.get(src_color),
                    "targetColor": asStr(dst_color)
                });
            }
            palette_json.maps.push(palette_map);
        }
        saveAs(new Blob([JSON.stringify(palette_json, null, 2)], {type: "application/octet-stream"}), `costumes.palettes`);
    }
}

async function getDraggedItems(items) {
    var entries = [];
    for (const item of items) {
        if (item.kind != "file") throw "Error: Dragged input was not a file, expecting image file(s)";
        const entry = await item.getAsFileSystemHandle(); 
        if (entry.kind != "file") throw "Error: Dragged input was not a file, expecting image file(s)";
        entries.push(entry);
    } 
    return entries;
}

window.addEventListener("load", (e) => {
    
    const result_box = document.getElementById("result");
    const base_button = document.getElementById("start_base_sprite");
    const palette_button = document.getElementById("start_palette_sprite");
    const can_modify_fs = ("showOpenFilePicker"  in window);
    if (!can_modify_fs) {
        base_button.disabled = true;
        palette_button.disabled = true;
        result_box.textContent = "Can't access the filesystem directly with this browser 😢. Try using something chromium ...";
        result_box.classList = "desc error_resp";
        console.error(`showOpenFilePicker is not supported in this browser`);
        return;
    }
    async function handleClickOrDrag(button) {
        return new Promise((resolve, reject) => {
            const dropListener = async (e) => {
                if (button.disabled) return;
                resolve(getDraggedItems(e.dataTransfer.items));
            }
            button.addEventListener("click", async (e) => {
                window.showOpenFilePicker({ id: "s", mode: "read", multiple: true, types: [{
                    description: "Images",
                    accept: {
                        "image/*": [".png", ".gif", ".jpeg", ".jpg"],
                    },
                }]}).then(resolve);
                button.removeEventListener("drop", dropListener);
            }, {once: true});
            button.addEventListener("drop", dropListener, {once: true});
        });
    }


    const parser = new PaletteParser();
    function handleBaseInput() {
        handleClickOrDrag(base_button).then((inp) => {
            // Update button name
            if (inp.length != 1) throw `Error: Expected 1 Base Sprite image, got ${inp.length} files.`;
            base_button.textContent = `Base Sprite: ${inp[0].name}`;
            base_button.disabled = true;
            result_box.classList = "desc info_resp";
            result_box.textContent = "Parsing base sprite ....";
            return inp[0];
        })
        .then(parser.addBaseSprite.bind(parser))
        .then(() => {
            result_box.classList = "desc info_resp";
            result_box.textContent = "Successfully parsed base sprite. Add other palette images to complete process.";
            palette_button.disabled = false;
        })
        .catch((err) => {
            base_button.disabled = false;
            result_box.textContent = `${err}`;
            result_box.classList = "desc error_resp";
            console.error(err);
        })
        .finally(handleBaseInput); // Setup listening for new input on fail/success
    }
    function handlePaletteInput() {

        handleClickOrDrag(palette_button).then((inp) => {
            // Update button name
            palette_button.disabled = true;
            palette_button.textContent = `${inp.length} Palette Sprite(s)`;
            result_box.classList = "desc info_resp";
            result_box.textContent = "Parsing palette sprites ....";
            return inp;
        })
        .then(parser.addPaletteSprites.bind(parser))
        .then(() => {
            parser.download();
            result_box.classList = "desc success_resp";
            result_box.textContent = "Successfully parsed palette from images";
            base_button.disabled = false;
            palette_button.disabled = true;
            base_button.textContent = "Put Base Sprite Here";
            palette_button.textContent = "Put Palette Sprites Here";
        })
        .catch((err) => {
            palette_button.disabled = false;
            result_box.textContent = `${err}`;
            result_box.classList = "desc error_resp";
            console.error(err);
        })
        .finally(handlePaletteInput); // Setup listening for new input on fail/success
    }

    palette_button.disabled = true;
    handleBaseInput();
    handlePaletteInput();

    document.addEventListener("dragover", (e) => { e.preventDefault(); });
    document.addEventListener("drop", async (e) => {
        e.preventDefault();
    });
});

/**
 * Python IMPL
 * 
#

from PIL import Image
from pathlib import Path
import numpy as np
from uuid import uuid4
import json

#

DEFAULT_NAME = "Untitled Palette Color"
TO_IGNORE = [(255, 255, 255, 255)]
colors = []

# load base_sprite
base_sprite_path = Path("base.png")
palette_paths = list(filter(lambda path: path != base_sprite_path, Path(".").glob("*.png")))
base_sprite = Image.open(base_sprite_path)

#

def array_in(to_check, array_list):
    return np.any(np.all(to_check == array_list, axis=1))

#

class ColorDims:
    RED = 0
    GREEN = 1
    BLUE = 2
    ALPHA = 3

def load_colors():
    for row in np.array(base_sprite):
        for color in row:
            color = tuple(color)
            if color[ColorDims.ALPHA] != 0 and color not in TO_IGNORE:
                colors.append(color)
load_colors()

#

def build_palette(base_sprite, other_sprite):
    base_pixels = np.array(base_sprite)
    palette_pixels = np.array(other_sprite)
    palette_map = {}
    shape = base_pixels.shape[:2]
    if shape != palette_pixels.shape[:2]:
        print("ERROR: Other sprite has the wrong shape!")
    for r in range(shape[0]):
        for c in range(shape[1]):
            src_color = tuple(base_pixels[r, c, :])
            dst_color = tuple(palette_pixels[r, c, :])
            if src_color not in colors:
                continue
            if src_color in palette_map and palette_map[src_color] != dst_color:
                print("ERROR: Trying to map colour to two different colours")
                return
            palette_map[src_color] = dst_color
    return palette_map

#

palettes = []
for palette_path in palette_paths:
    palette_name = palette_path.stem
    palette_sprite = Image.open(palette_path)
    palettes.append((palette_name, build_palette(base_sprite, palette_sprite)))

#

def to_argb(color):
    return f"0x{hex((color[ColorDims.ALPHA] << 24) | (color[ColorDims.RED] << 16)  | (color[ColorDims.GREEN] << 8) | color[ColorDims.BLUE]).upper()[2:]}"

#

palette_json = {
    "export": True,
    "guid": str(uuid4()),
    "colors": [],
    "maps": [],
    "imageAsset": "",
    "id": "testPalette",
    "pluginMetadata": {
        "com.fraymakers.FraymakersMetadata": {
        "version": "0.1.2"
        }
    },
    "plugins": [
        "com.fraymakers.FraymakersMetadata"
    ],
    "tags": [
    ],
    "version": 1
}

color_ids = {}
color_json = palette_json["colors"]
maps_json = palette_json["maps"]
maps_json.append({
    "$id": str(uuid4()),
    "colors": [],
    "name": "Base",
    "pluginMetadata": {
        "com.fraymakers.FraymakersMetadata": {
            "isBase": True
        }
    },
})

for color in colors:
    color_json.append({
        "$id": str(uuid4()),
        "color": to_argb(color),
        "name": DEFAULT_NAME,
        "pluginMetadata": {}
    })
    maps_json[-1]["colors"].append({
        "paletteColorId": color_json[-1]["$id"],
        "targetColor": color_json[-1]["color"]
    })
    color_ids[color] = color_json[-1]["$id"]

for name, palette in palettes:
    palette_map = {
        "$id": str(uuid4()),
        "colors": [],
        "name": name,
        "pluginMetadata": {
            "com.fraymakers.FraymakersMetadata": {
                "isBase": False
            }
        }
    }
    for src_color, dst_color in palette.items():
        palette_map["colors"].append({
            "paletteColorId": color_ids[src_color],
            "targetColor": to_argb(dst_color)
        })
    maps_json.append(palette_map)

#

with Path("test.palettes").open("w") as json_file:
    json.dump(palette_json, json_file, indent=2)
 */