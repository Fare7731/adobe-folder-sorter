// =========================================================
// POLYFILLS (Patching old ExtendScript for AE)
// =========================================================

// Add .indexOf support for arrays (required for older AE versions)
if (!Array.prototype.indexOf) {
    Array.prototype.indexOf = function(searchElement, fromIndex) {
        var k;
        if (this == null) throw new TypeError('"this" is null or not defined');
        var O = Object(this);
        var len = O.length >>> 0;
        if (len === 0) return -1;
        var n = +fromIndex || 0;
        if (Math.abs(n) === Infinity) n = 0;
        if (n >= len) return -1;
        k = Math.max(n >= 0 ? n : len - Math.abs(n), 0);
        while (k < len) {
            if (k in O && O[k] === searchElement) return k;
            k++;
        }
        return -1;
    };
}

// Load event library (PlugPlugExternalObject)
try {
    var xLib = new ExternalObject("lib:\PlugPlugExternalObject");
} catch(e) { /* Ignore if library is missing */ }

// =========================================================
// LOGGING SYSTEM
// =========================================================

// Helper: Send logs to Chrome Console (localhost:8088)
function jsxLog(message) {
    try {
        if (typeof CSXSEvent !== "undefined") {
            var eventObj = new CSXSEvent();
            eventObj.type = "com.foldersorter.debug"; 
            eventObj.data = message.toString();
            eventObj.dispatch();
        }
    } catch(e) {}
}

// Entry Point
function runSorter() {
    try {
        var appName = BridgeTalk.appName;
        jsxLog("=== STARTER ===");
        jsxLog("App detected: " + appName);

        if (appName == "premierepro") {
            return sortPremiere();
        } else if (appName == "aftereffects") {
            return sortAfterEffects();
        } else {
            return "Unknown App: " + appName;
        }
    } catch (e) {
        var errInfo = "CRASH MAIN: " + e.message + " (Line: " + e.line + ")";
        jsxLog(errInfo);
        return errInfo;
    }
}

// ---------------------------------------------------------
// PREMIERE PRO LOGIC
// ---------------------------------------------------------
function sortPremiere() {
    jsxLog("--- Starting Premiere Sort ---");
    
    var project = app.project;
    if (!project) return "No project found";
    var root = project.rootItem;
    
    // CATEGORY CONFIGURATION
    var categories = {
        // Images
        'jpg': 'Images', 'jpeg': 'Images', 'png': 'Images', 'gif': 'Images', 'tiff': 'Images', 'psd': 'Images', 'ai': 'Images',
        // Video
        'mp4': 'Video', 'mov': 'Video', 'avi': 'Video', 'mxf': 'Video', 'r3d': 'Video', 'mts': 'Video', 'braw': 'Video',
        // Audio
        'mp3': 'Audio', 'wav': 'Audio', 'aif': 'Audio', 'wma': 'Audio', 'aac': 'Audio',
        // Data
        'xml': 'Data', 'csv': 'Data', 'srt': 'Data',
        // Dynamic Link
        'aep': 'Dynamic Link', 
        'prproj': 'Dynamic Link',
        'plb': 'Dynamic Link' // Premiere Library
    };

    var itemsToMove = [];
    var binCache = {};

    jsxLog("Phase 1: Scanning root (" + root.children.numItems + " items)...");
    
    for (var i = 0; i < root.children.numItems; i++) {
        var item = root.children[i];
        if (!item) continue;

        var debugInfo = "[" + i + "] " + item.name + " (Type: " + item.type + ")";
        jsxLog(debugInfo);

        if (item.type === 2) continue; // Skip Bins

        var targetFolder = "Others";
        var shouldMove = false;
        var isSeq = false;

        // Sequence Detection
        if (item.type === 1) { // CLIP
            if (typeof item.isSequence === 'function') {
                isSeq = item.isSequence();
            } else {
                // Fallback: If no media path, it's likely a sequence or synthetic item
                var mediaPath = "";
                try { mediaPath = item.getMediaPath(); } catch(e){}
                isSeq = (mediaPath === undefined || mediaPath === "" || mediaPath === null);
            }
        }

        if (isSeq) {
            targetFolder = "Sequences";
            shouldMove = true;
        } else {
            // Extension Detection
            var parts = item.name.split('.');
            if (parts.length > 1) {
                var ext = parts.pop().toLowerCase();
                
                // Check categories
                if (categories[ext]) {
                    targetFolder = categories[ext];
                    shouldMove = true;
                }
            }
        }

        if (shouldMove) {
            itemsToMove.push({item: item, folderName: targetFolder});
        }
    }

    if (itemsToMove.length === 0) {
        jsxLog("Nothing to move.");
        return "No files to sort.";
    }

    jsxLog("Phase 2: Moving " + itemsToMove.length + " items...");
    
    var uniqueFolders = {};
    for (var k = 0; k < itemsToMove.length; k++) {
        uniqueFolders[itemsToMove[k].folderName] = true;
    }

    // Creating Bins
    for (var fName in uniqueFolders) {
        if (!binCache[fName]) {
            var found = false;
            for (var m = 0; m < root.children.numItems; m++) {
                if (root.children[m].type === 2 && root.children[m].name === fName) {
                    binCache[fName] = root.children[m];
                    found = true;
                    break;
                }
            }
            if (!found) {
                try {
                    binCache[fName] = root.createBin(fName);
                } catch(binErr) {
                    jsxLog("ERROR creating bin '" + fName + "': " + binErr.message);
                }
            }
        }
    }

    // Moving Items
    var movedCount = 0;
    for (var j = 0; j < itemsToMove.length; j++) {
        var t = itemsToMove[j];
        var targetBin = binCache[t.folderName];

        if (targetBin) {
            try {
                // Ensure we don't move file into itself or if it's already there
                if (t.item.treePath !== targetBin.treePath) {
                    t.item.moveBin(targetBin);
                    movedCount++;
                }
            } catch(moveErr) {
                jsxLog("ERROR moving " + t.item.name + ": " + moveErr.message);
            }
        }
    }

    jsxLog("--- Premiere Sort Complete. Moved: " + movedCount + " ---");
    return "Sorted " + movedCount + " files";
}

// ---------------------------------------------------------
// AFTER EFFECTS LOGIC
// ---------------------------------------------------------
function sortAfterEffects() {
    jsxLog("--- Starting AE Sort (v4 Dynamic Link) ---");
    var project = app.project;
    
    // Wrap entire operation in Undo Group
    app.beginUndoGroup("Folder Sorter");

    try {
        var items = project.items;
        var extensions = {};
        var precomps = [];
        var count = 0;
        
        jsxLog("Scanning root items (" + items.length + ")...");

        for (var i = 1; i <= items.length; i++) {
            var item = items[i];
            
            // Process only items in the root folder
            if (item.parentFolder !== project.rootFolder) continue;
            var itemLog = "[" + i + "] " + item.name + " (" + item.typeName + ")";
            
            // Skip Folders
            if (item instanceof FolderItem) continue;

            if (item instanceof FootageItem) {
                // Skip Solids
                if (item.mainSource instanceof SolidSource) {
                    jsxLog(itemLog + " -> SKIP (Solid)");
                    continue; 
                }
                // Skip Placeholders
                if (item.mainSource instanceof PlaceholderSource) continue;

                var ext = "";
                try {
                     var parts = item.name.split('.');
                     if (parts.length > 1) ext = parts.pop().toLowerCase();
                } catch(e) {
                    jsxLog(itemLog + " -> Name parse error");
                }

                // --- MAPPING ---
                if (['jpeg', 'jpg', 'png', 'tiff', 'tif', 'psd', 'exr', 'tga', 'webp', 'bmp'].indexOf(ext) !== -1) ext = 'images';
                if (['mov', 'mp4', 'mxf', 'avi', 'webm', 'mkv', 'flv', 'r3d', 'braw', 'mts'].indexOf(ext) !== -1) ext = 'video';
                if (['ai', 'eps', 'pdf', 'svg'].indexOf(ext) !== -1) ext = 'vector';
                if (['wav', 'mp3', 'aac', 'm4a', 'wma', 'aiff'].indexOf(ext) !== -1) ext = 'audio';
                if (['glb', 'gltf', 'sbsar', 'obj', 'fbx', 'c4d'].indexOf(ext) !== -1) ext = '3d';
                
                // Dynamic Link
                if (['aep', 'aepx', 'prproj'].indexOf(ext) !== -1) ext = 'dl';

                jsxLog(itemLog + " -> Category: " + ext);

                if (!extensions[ext]) extensions[ext] = [];
                extensions[ext].push(item);

            } else if (item instanceof CompItem) {
                // Check if it's not a technical/adjustment comp
                if (!isAdjustmentLayerComp(item)) {
                    precomps.push(item);
                }
            }
        }

        jsxLog("Moving items...");

        for (var ext in extensions) {
            if (ext === "") continue; 

            var folderName = "Others"; 
            if (ext === 'images') folderName = "Images";
            if (ext === 'video')  folderName = "Video Files";
            if (ext === 'vector') folderName = "Vector Files";
            if (ext === 'audio')  folderName = "Audio Files";
            if (ext === '3d')     folderName = "3D Models";
            if (ext === 'dl')     folderName = "Dynamic Link";

            // Fallback for unknown extensions
            if (['images', 'video', 'vector', 'audio', '3d', 'dl'].indexOf(ext) === -1) {
                folderName = ext.toUpperCase() + " Files";
            }

            var targetFolder = findOrCreateFolderAE(folderName);
            var list = extensions[ext];
            for (var j = 0; j < list.length; j++) {
                try {
                    list[j].parentFolder = targetFolder;
                    count++;
                } catch(err) {
                    jsxLog("ERROR moving " + list[j].name + ": " + err.message);
                }
            }
        }

        // Move Compositions
        if (precomps.length > 0) {
            var precompFolder = findOrCreateFolderAE("Compositions");
            for (var k = 0; k < precomps.length; k++) {
                precomps[k].parentFolder = precompFolder;
                count++;
            }
        }

        // Cleanup Empty Folders
        removeEmptyFoldersAE();

        app.endUndoGroup();
        jsxLog("--- AE Sort Complete. Moved: " + count + " ---");
        return "Sorted " + count + " items";

    } catch (e) {
        app.endUndoGroup();
        var errArgs = "CRASH AE: " + e.message + " (Line: " + e.line + ")";
        jsxLog(errArgs);
        return errArgs;
    }
}

// AE Utilities
function findOrCreateFolderAE(name) {
    var items = app.project.items;
    for (var i = 1; i <= items.length; i++) {
        if (items[i] instanceof FolderItem && items[i].name === name) return items[i];
    }
    return app.project.items.addFolder(name);
}

function isAdjustmentLayerComp(comp) {
    if (comp.numLayers === 1) {
        var layer = comp.layer(1);
        return layer.adjustmentLayer;
    }
    return false;
}

function removeEmptyFoldersAE() {
    var project = app.project;
    for (var i = project.items.length; i >= 1; i--) {
        var item = project.items[i];
        if (item instanceof FolderItem && item.numItems === 0 && item.parentFolder === project.rootFolder) {
            // Do not delete the Solids folder
            if (item.name !== "Solids") item.remove();
        }
    }
}
