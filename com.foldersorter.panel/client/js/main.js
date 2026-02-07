(function () {
    'use strict';
    
    var csInterface = new CSInterface();
    
    // ============================================
    // SETTINGS
    // ============================================
    // true = enable console logs (for dev)
    // false = silence (for release)
    var IS_DEBUG = true; 

    // Author's URL
    var AUTHOR_URL = "https://fareeditor.crd.co";
    // ============================================


    // --- 1. LOGGER ---
    if (IS_DEBUG) {
        csInterface.addEventListener("com.foldersorter.debug", function(event) {
            console.log("%c[JSX]", "color: #bada55; font-weight: bold;", event.data);
        });
    }

    // --- 2. SORT BUTTON ---
    document.getElementById('sortBtn').addEventListener('click', function () {
        var statusDiv = document.getElementById('status');
        statusDiv.innerText = "Processing...";
        statusDiv.style.color = "#ffff00";

        if (IS_DEBUG) console.log("--- UI: Button Clicked ---");
        
        csInterface.evalScript('runSorter()', function(result) {
            if (IS_DEBUG) console.log("[UI] Result received:", result);
            
            statusDiv.innerText = result;
            
            // Check for errors/crashes in the result string
            if (result && (result.indexOf("CRASH") !== -1 || result.indexOf("Error") !== -1)) {
                statusDiv.style.color = "#ff5555";
            } else {
                statusDiv.style.color = "#777";
            }

            // Reset status after 3 seconds
            setTimeout(function() {
                if (statusDiv.innerText === result) { 
                    statusDiv.innerText = "Ready";
                    statusDiv.style.color = "#777";
                }
            }, 3000);
        });
    });

    // --- 3. AUTHOR LINK ---
    // Standard <a href> might fail or open inside the panel.
    // Using CSInterface API to open in default OS browser.
    document.getElementById('authorLink').addEventListener('click', function() {
        csInterface.openURLInDefaultBrowser(AUTHOR_URL);
    });
    
}());
