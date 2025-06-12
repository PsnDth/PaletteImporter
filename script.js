
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
        let colorHex = 0;
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

class ColorInfo {
    static DEFAULT_COLOR_NAME = "Untitled Palette Color"
    constructor(id, color, name, pluginMetadata) {
        this.id = id; 
        this.color = color;
        this.name = name || ColorInfo.DEFAULT_COLOR_NAME;
        this.pluginMetadata  = pluginMetadata || {};
    }

    static colorToString(color) {
        return "0x" + color.toString(16).padStart(8, "0").toUpperCase();
    }

    colorStr() {
        return ColorInfo.colorToString(this.color);
    }

    static findByID(color_map, id) {
        for (const [color, color_info] of color_map.entries()) {
            if (color_info.id == id) return color_info;
        }
        return null;
    }

    static fromJSON(info) {
        return new ColorInfo(info["$id"], parseInt(info["color"]), info["name"], info["pluginMetadata"]);
    }

    toJSON() {
        return {
            "$id": this.id,
            "color": this.colorStr(),
            "name": this.name,
            "pluginMetadata": this.pluginMetadata
        }
    }
}

class PaletteInfo {
    constructor(name, id, pluginMetadata, isBase = false) {
        this.id = id || crypto.randomUUID();
        this.name = name;
        this.map = new Map();
        this.pluginMetadata  = pluginMetadata ||  {
            "com.fraymakers.FraymakersMetadata": {
                "isBase": isBase
            }
        };
    }

    markAsBase(isBase) {
        if (this.pluginMetadata && this.pluginMetadata["com.fraymakers.FraymakersMetadata"]) {
            this.pluginMetadata["com.fraymakers.FraymakersMetadata"].isBase = isBase;
        }
    }

    isBase() {
        if (this.pluginMetadata && this.pluginMetadata["com.fraymakers.FraymakersMetadata"]) {
            return this.pluginMetadata["com.fraymakers.FraymakersMetadata"].isBase;
        }
        return false;
    }

    static fromJSON(info, color_map) {
        const palette_info = new PaletteInfo(info["name"], info["$id"], info["pluginMetadata"]);
        for (const entry of info.colors) {
            palette_info.map.set(
                ColorInfo.findByID(color_map, entry.paletteColorId).color,
                parseInt(entry.targetColor),
            );
        }
        return palette_info;
    }


    toJSON(color_map) {
        const palette_map = {
            "$id": this.id,
            "colors": [],
            "name": this.name,
            "pluginMetadata": this.pluginMetadata
        };
        for (const [src_color, dst_color] of this.map.entries()) {
            palette_map.colors.push({
                "paletteColorId": color_map.get(src_color).id,
                "targetColor": ColorInfo.colorToString(dst_color),
            });
        }
        return palette_map;
    }
}

class PaletteParser {
    static DEFAULT_FILENAME = "costumes.palettes"

    constructor() {
        this.base_image_file = null;
        this.palette_image_files = [];
        this.base_palette_json_file = null;
        this.palette_json_files = [];
        this.warnings_cache = [];
        this.warned_colors = [];
        this.reset();
    }

    renderWarnings() {
        let warnings = [];
        for (const warning of this.warnings_cache) {
            const warning_span = document.createElement('span');
            warning_span.classList.add("warning");
            warning_span.textContent = `WARNING: ${warning}`;
            warnings.push(warning_span);
            console.log(warning_span);
        }
        this.warnings_cache = [];
        this.warned_colors = [];
        return warnings;
    }

    tryWarnFor(src_color, dst_color, warning) {
        const warning_key = JSON.stringify([src_color, dst_color]);
        if (this.warned_colors.includes(warning_key)) return;
        this.warnings_cache.push(warning);
        this.warned_colors.push(warning_key);
    }

    reset() {
        this.colors = new Map(); // maps color to ID
        this.palettes = new Map();
        this.base_image = null;
        this.base_size = [0, 0];
        this.palette_json_template = {
            "export": true,
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
    }

    async reapplyFiles() {
        this.reset();
        if (this.base_palette_json_file) await this.addBasePaletteFile(this.base_palette_json_file);
        if (this.base_image_file) {
            await this.addBaseSprite(this.base_image_file);
            if (this.palette_image_files.length) await this.addPaletteSprites(this.palette_image_files);
        }
        if (this.palette_json_files.length) await this.addPaletteFiles(this.palette_json_files);
    }

    static getPaletteCopyName(name, copy_idx) {
        if (copy_idx <= 0) return name;
        if (copy_idx == 1) return `${name} (copy)`;
        return `${name} (copy ${copy_idx - 1})`;
    }

    addPaletteSafely(name, palette) {
        let copy_idx = 0;
        while (this.palettes.has(PaletteParser.getPaletteCopyName(name, copy_idx))) {
            copy_idx += 1;
        }
        name = PaletteParser.getPaletteCopyName(name, copy_idx);
        palette.name = name;
        this.palettes.set(name, palette);
    }

    async loadPaletteFile(fhandle) {
        const reader = new FileReader(); 
        const file = await fhandle.getFile();
        return new Promise((resolve, reject) => {
            reader.onload = (event) => {
                try {
                    resolve(JSON.parse(event.target.result));
                } catch (e) {
                    if (e instanceof SyntaxError) {
                        reject(`${file} is not a valid palette file.`);
                    } else {
                        reject(e.target.result);
                    }
                }
            };
            reader.onerror = reject;
            reader.readAsText(file);
        });
    }

    async addPaletteFile(fhandle, is_base = false) {
       const palette_json = await this.loadPaletteFile(fhandle);
       let old_colors = new Map(this.colors);
       if (is_base) this.colors.clear();
       for (const color_json of palette_json.colors) {
           const color_info = ColorInfo.fromJSON(color_json);
           if (this.colors.has(color_info.color)) continue;
           this.colors.set(color_info.color, color_info);
        }
        // readd the old colors
        for (const [color, color_info] of old_colors.entries()) {
            if (this.colors.has(color)) continue;
            this.colors.set(color, color_info);
        }

        let old_palettes = new Map(this.palettes);
        // Add the base palettes first
        if (is_base) this.palettes.clear();
        for (const palette_map_json of palette_json.maps) {
            const palette_info = PaletteInfo.fromJSON(palette_map_json, this.colors);
            this.addPaletteSafely(palette_info.name, palette_info);
        }
        if (is_base) {
            // Re-add the old_palettes
            for (const [name, palette] of old_palettes.entries()) {
                this.addPaletteSafely(name, palette);
            }

            // also copy over things into the json template
            const{colors, maps, ...cleaned_palette_json} = palette_json;
            this.palette_json_template = cleaned_palette_json;
        }
    }

    async addBasePaletteFile(fhandle) {
        const IS_BASE = true;
        await this.addPaletteFile(fhandle, IS_BASE);
        this.base_palette_json_file = fhandle;
        this.filename = fhandle.name;
    }

    async addPaletteFiles(fhandles) {
        for await (const fhandle of fhandles) {
            await this.addPaletteFile(fhandle);
        }
        this.palette_json_files = fhandles;
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
                    this.colors.set(src_color, new ColorInfo(crypto.randomUUID(), src_color));
                }
            });
            this.base_image_file = fhandle;
            resolve(this);
        });
    }

    async addPaletteSprite(fhandle) {
        const name = basename(fhandle.name);
        const pal_sprite = await this.loadImage(fhandle);
        const img =  await Jimp.read(pal_sprite);
        return new Promise((resolve, reject) => {
            if (img.bitmap.width != this.base_size[0] || img.bitmap.height != this.base_size[1]) {
                return reject(`Palette file "${name}" has the wrong file dimensions compared to base sprite. Base dimensions: ${this.base_size[0]}x${this.base_size[1]}; Current dimensions: ${img.bitmap.width}x${img.bitmap.height}`);
            }

            const dst_pixels = img.bitmap.data;
            let curr_palette = new Map();
            img.scan(0, 0, img.bitmap.width, img.bitmap.height, (x, y, i) => {
                if (dst_pixels[i+ColorDims.ALPHA] == 0) return; // Ignore transparent pixels
                const src_color = this.base_image[i/4];
                const dst_color = ColorParser.RGBAtoARGBHex(...dst_pixels.slice(i, i+4));
                if (src_color === undefined || !this.colors.has(src_color)) {
                    this.tryWarnFor(
                        src_color, dst_color,
                        `Found conflicting colour in file "${name}". @(${x}, ${y}) Trying to map transparent/unmapped colour to RGBA(${new ColorParser(dst_color).rgba})`
                    );
                    return;
                }
                if (curr_palette.has(src_color) && curr_palette.get(src_color) != dst_color) {
                    this.tryWarnFor(
                        src_color, dst_color,
                        `Found conflicting colour in file "${name}". @(${x}, ${y}) Trying to map RGBA(${new ColorParser(src_color).rgba}) to RGBA(${new ColorParser(dst_color).rgba}). Previously mapped to RGBA(${new ColorParser(curr_palette.get(src_color)).rgba})`
                    );
                    return;
                }
                curr_palette.set(src_color, dst_color);
            });
            const palette_info = new PaletteInfo(name);
            palette_info.map = curr_palette;
            this.addPaletteSafely(name, palette_info);
            resolve(this);
        });
    }
    
    async addPaletteSprites(fhandles) {
        for await (const fhandle of fhandles) {
            await this.addPaletteSprite(fhandle);
        }
        this.palette_image_files = fhandles;
    }

    canDownloadPalettes() {
        return (this.base_image_file && this.palette_image_files.length > 0) || this.palette_json_files.length > 0;
    }

    download() {
        const filename = this.filename || PaletteParser.DEFAULT_FILENAME;
        let palette_json = {
            ...{colors: [], maps: [], guid: crypto.randomUUID(), },
            ...this.palette_json_template,
        };

        palette_json.colors = [...this.colors.values().map(color_info => color_info.toJSON())];
        if (this.palettes.values().find(palette_info => palette_info.isBase()) === undefined) {
            for (const palette_info of this.palettes.values()) {
                palette_info.markAsBase(true);
                break;
            }
        } 
        palette_json.maps = [...this.palettes.values().map(palette_info => palette_info.toJSON(this.colors))];
        saveAs(new Blob([JSON.stringify(palette_json, null, 2)], {type: "application/octet-stream"}), filename);
    }
}

class InputHandler {
    static IMAGES_ONLY = {
        description: "Images",
        accept: {
            "image/*": [".png", ".gif", ".jpeg", ".jpg"],
        },
        excludeAcceptAllOption: true
    };
    static PALETTE_FILES_ONLY = {
        description: "Fraytools Palette Files",
        accept: {
            "application/json": [".palettes"],
        },
    };

    constructor(parser) {
        this.parser = parser;

        this.base_sprite_button = document.getElementById("start_base_sprite");
        this.palette_sprite_button = document.getElementById("start_palette_sprite");
        this.palette_file_button = document.getElementById("start_palette_file");
        this.palette_ext_button = document.getElementById("start_palette_ext");
        this.export_button = document.getElementById("export");
        this.buttons = [
            this.base_sprite_button,
            this.palette_sprite_button,
            this.palette_file_button,
            this.palette_ext_button,
            this.export_button,
        ];
        this.old_button_states = this.buttons.map(b => b.disabled);
    }

    disableAll() {
        this.buttons.forEach(b => {b.disabled = true});
    }

    async doParserTask(task, params) {
        // Prevent user interaction
        this.old_button_states = this.buttons.map(b => b.disabled);
        this.disableAll();
        
        
        try {
            await task(params);
            this.buttons.forEach((b, i) => {b.disabled = this.old_button_states[i]});
        } catch (e) {
            this.buttons.forEach((b, i) => {b.disabled = this.old_button_states[i]});
            throw e;
        }
        // Allow user interaction again
    }

    static clearWarnings(result_box) {
        let warnings = result_box.querySelectorAll('.warning');
        for (const warning of warnings) {
            result_box.removeChild(warning);
        }
    }

    renderWarnings(result_box) {
        InputHandler.clearWarnings(result_box);
        for (const warning of this.parser.renderWarnings()) {
            result_box.appendChild(warning);
        }
    }



    checkEnableExport() {
        this.export_button.disabled = !this.parser.canDownloadPalettes();
        if (this.export_button.disabled) {
            console.log(`Can't export because has_images=${(this.parser.base_image_file && this.parser.palette_image_files.length > 0)} has_files=${this.parser.palette_json_files.length > 0}`);
        }
    }

    static async getDraggedItems(items) {
        let entries = [];
        for (const item of items) {
            if (item.kind != "file") throw "Error: Dragged input was not a file, expecting image file(s)";
            const entry = await item.getAsFileSystemHandle(); 
            if (entry.kind != "file") throw "Error: Dragged input was not a file, expecting image file(s)";
            entries.push(entry);
        } 
        return entries;
    }

    static async handleClickOrDrag(button, fileType) {
        return new Promise((resolve, reject) => {
            const dropListener = async (e) => {
                if (button.disabled) return;
                resolve(InputHandler.getDraggedItems(e.dataTransfer.items));
            }
            button.addEventListener("click", async (e) => {
                window.showOpenFilePicker({ id: "s", mode: "read", multiple: true, types: [fileType]}).then(resolve).catch((err) => {
                    if (err instanceof DOMException && err.name == "AbortError") {
                        reject("No file selected, please try again.");
                    } else {
                        reject(err);
                    }
                });
                button.removeEventListener("drop", dropListener);
            }, {once: true});
            button.addEventListener("drop", dropListener, {once: true});
        });
    }

    initPaletteSpriteInputs() {    
        const result_box = document.getElementById("palette_image_status");
        const handleBaseInput =  () => {
            InputHandler.handleClickOrDrag(this.base_sprite_button, InputHandler.IMAGES_ONLY).then((inp) => {
                // Update button name
                if (inp.length != 1) throw `Error: Expected 1 Base Sprite image, got ${inp.length} files.`;
                this.base_sprite_button.textContent = `Base Sprite: ${inp[0].name}`;
                clearWarnings(result_box);
                result_box.classList = "desc info_resp";
                result_box.textContent = "Parsing base sprite ....";
                return inp[0];
            })
            .then(fh => {
                return this.doParserTask(async f => {
                    this.parser.base_image_file = null;
                    await this.parser.reapplyFiles();
                    await this.parser.addBaseSprite(f);
                }, fh);
            })
            .then(() => {
                this.checkEnableExport();
                result_box.classList = "desc info_resp";
                let result_text = "Successfully parsed base sprite.";
                if (!this.parser.palette_image_files.length) {
                    result_text += " Add other palette images to complete process.";
                }
                result_box.textContent = result_text;
                this.renderWarnings(result_box);
                this.base_sprite_button.disabled = false;
                this.palette_sprite_button.disabled = false;
            })
            .catch((err) => {
                this.checkEnableExport();
                this.base_sprite_button.disabled = false;
                result_box.textContent = `${err}`;
                InputHandler.clearWarnings(result_box);
                result_box.classList = "desc error_resp";
                console.error(err);
            })
            .finally(handleBaseInput); // Setup listening for new input on fail/success
        }
        const handlePaletteInput = () => {
            InputHandler.handleClickOrDrag(this.palette_sprite_button, InputHandler.IMAGES_ONLY).then((inp) => {
                // Update button name
                this.palette_sprite_button.textContent = `${inp.length} Palette Sprite(s)`;
                result_box.classList = "desc info_resp";
                result_box.textContent = "Parsing palette sprites ....";
                InputHandler.clearWarnings(result_box);
                // before actually adding them,  reset the parser if necessary
                return inp;
            })
            .then(fh => {
                return this.doParserTask(async f => {
                    if (this.parser.palette_image_files.length) {
                        this.parser.palette_image_files = [];
                        await this.parser.reapplyFiles();
                    }
                    await this.parser.addPaletteSprites(f);
                }, fh);
            })
            .then(() => {
                this.checkEnableExport();
                result_box.classList = "desc success_resp";
                result_box.textContent = `Successfully parsed palette from images.`;
                this.renderWarnings(result_box);
            })
            .catch((err) => {
                this.checkEnableExport();
                this.palette_sprite_button.disabled = false;
                result_box.textContent = `${err}`;
                InputHandler.clearWarnings(result_box);
                result_box.classList = "desc error_resp";
                console.error(err);
            })
            .finally(handlePaletteInput); // Setup listening for new input on fail/success
        }

        this.palette_sprite_button.disabled = true;
        handleBaseInput();
        handlePaletteInput();
    }

    initPaletteFileInputs() {
        const result_box = document.getElementById("palette_file_status");
        const handleBaseInput = () => {
            InputHandler.handleClickOrDrag(this.palette_file_button, InputHandler.PALETTE_FILES_ONLY).then((inp) => {
                // Update button name
                if (inp.length != 1) throw `Error: Expected 1 Target Palette file, got ${inp.length} files.`;
                this.palette_file_button.textContent = `Target Palette: ${inp[0].name}`;
                result_box.classList = "desc info_resp";
                result_box.textContent = "Parsing target palette file ....";
                InputHandler.clearWarnings(result_box);
                return inp[0];
            })
            .then(fh => {
                return this.doParserTask(async f => {
                    this.parser.base_palette_json_file = null;
                    this.parser.reapplyFiles();
                    await this.parser.addBasePaletteFile(f);
                }, fh);
            })
            .then(() => {
                this.checkEnableExport();
                result_box.classList = "desc success_resp";
                result_box.textContent = "Successfully parsed target palette file";
                this.renderWarnings(result_box);
            })
            .catch((err) => {
                this.checkEnableExport();
                result_box.textContent = `${err}`;
                InputHandler.clearWarnings(result_box);
                result_box.classList = "desc error_resp";
                console.error(err);
            })
            .finally(handleBaseInput); // Setup listening for new input on fail/success
        }
        const handlePaletteInput = () => {
            InputHandler.handleClickOrDrag(this.palette_ext_button, InputHandler.PALETTE_FILES_ONLY).then((inp) => {
                this.palette_ext_button.textContent = `${inp.length} Palette File(s)`;
                result_box.classList = "desc info_resp";
                result_box.textContent = "Parsing palette files ....";
                InputHandler.clearWarnings(result_box);
                // before actually adding them,  reset the parser if necessary
                return inp;
            })
            .then(fh => {
                return this.doParserTask(async f => {
                    if (this.parser.palette_json_files.length) {
                        this.parser.palette_json_files = [];
                        await this.parser.reapplyFiles();
                    }
                    await this.parser.addPaletteFiles(f);
                }, fh);
            })
            .then(() => {
                this.checkEnableExport();
                result_box.classList = "desc success_resp";
                result_box.textContent = "Successfully parsed palettes from provided files";
                this.renderWarnings(result_box);
            })
            .catch((err) => {
                this.checkEnableExport();
                result_box.textContent = `${err}`;
                InputHandler.clearWarnings(result_box);
                result_box.classList = "desc error_resp";
                console.error(err);
            })
            .finally(handlePaletteInput); // Setup listening for new input on fail/success
        }
        handleBaseInput();
        handlePaletteInput();
    }

    initExportButton() {
        this.export_button.addEventListener("click", (e) => {
            if (this.export_button.disabled) return;
            this.parser.download();
        });
        this.checkEnableExport();
    }

    init() {
        this.initPaletteSpriteInputs();
        this.initPaletteFileInputs();
        this.initExportButton();
    }
}

window.addEventListener("load", (e) => {
    const global_result_box = document.getElementById("result");
    const input_handler = new InputHandler();
    const can_modify_fs = ("showOpenFilePicker"  in window);
    if (!can_modify_fs) {
        input_handler.disableAll();
        global_result_box.textContent = "Can't access the filesystem directly with this browser 😢. Try using something chromium ...";
        global_result_box.classList = "desc error_resp";
        console.error(`showOpenFilePicker is not supported in this browser`);
        return;
    }
    const parser = new PaletteParser();
    input_handler.parser = parser;
    input_handler.init();

    document.addEventListener("dragover", e => e.preventDefault());
    document.addEventListener("drop", async e => e.preventDefault());
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