const Mainloop = imports.mainloop;
const {St, Clutter} = imports.gi;
const Main = imports.ui.main;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

let devDescriptions;
let panelButton;
let panelButtonText;
let timeout;
let visible;

function getCurrentFile() {
    let stack = (new Error()).stack;

    // Assuming we're importing this directly from an extension (and we shouldn't
    // ever not be), its UUID should be directly in the path here.
    let stackLine = stack.split('\n')[1];
    if (!stackLine)
        throw new Error('Could not find current file');

    // The stack line is like:
    //   init([object Object])@/home/user/data/gnome-shell/extensions/u@u.id/prefs.js:8
    //
    // In the case that we're importing from
    // module scope, the first field is blank:
    //   @/home/user/data/gnome-shell/extensions/u@u.id/prefs.js:8
    let match = new RegExp('@(.+):\\d+').exec(stackLine);
    if (!match)
        throw new Error('Could not find current file');

    let path = match[1];
    let file = Gio.File.new_for_path(path);
    return [file.get_path(), file.get_parent().get_path(), file.get_basename()];
}

function init () {
    // get the contents of the json file
    let [, extensionPath,] = getCurrentFile()
    let [ok, contents] = GLib.file_get_contents(extensionPath + '/devices.json');
    if (ok) {
        devDescriptions = JSON.parse(contents);
    } else {
        devDescriptions = {}
    }
    visible = false;
    // Create a Button
    panelButton = new St.Bin({
        style_class : "panel-button",
    });
    
    panelButtonText = new St.Label({
        text : "",
        y_align: Clutter.ActorAlign.CENTER,
    });

    panelButton.set_child(panelButtonText);

    startDaemon();
}

//start adb daemon on init
function startDaemon() {
    GLib.spawn_async(null, ["bash", "-c", "adb devices"], null, GLib.SpawnFlags.SEARCH_PATH, null, null);
}

function getModel() {
    let cmd = 'adb shell getprop ro.product.model';
    let [res, out, error, status] = GLib.spawn_sync(null, ["bash", "-c", cmd], null, GLib.SpawnFlags.SEARCH_PATH, null);
    return out.toString().replace("\n", "");
}

function getDevDescription(model) {
    let ret = model
    if (ret in devDescriptions) {
      let brand = devDescriptions[ret]["brand"]
      let name = devDescriptions[ret]["name"]
      ret = brand + ((name !== "") ? " " + name : "")
    }
    return (ret !== "") ? ret : model;
}

function getChargeInfo() {
    let cmd = 'adb shell dumpsys battery';
    let [res, out, error, status] = GLib.spawn_sync(null, ["bash", "-c", cmd], null, GLib.SpawnFlags.SEARCH_PATH, null);
    if (status !== 0) {
        return ""
    }
    let result = txtToMap(out.toString());
    if (result.size == 0) {
        return ""
    }
    return (result.has("level") ? "Battery " + result.get("level") + "%" : "getting battery info error") + " (" + getDevDescription(getModel()) + ")";
}

function showInfo() {
    if (!visible) {
        // Add the button to the panel
        Main.panel._rightBox.insert_child_at_index(panelButton, 0);
        visible = true;
    }
}

function hideInfo() {
    if (visible) {
        visible = false;
        Main.panel._rightBox.remove_child(panelButton);
    }
}

function updateBattery() {
    let info = getChargeInfo()
    if (info !== "") {
        panelButtonText.set_text(info);
        showInfo();
    } else {
        hideInfo()
    }
    return true;
}

function enable() {
    showInfo();
    timeout = Mainloop.timeout_add_seconds(10.0, updateBattery);
    updateBattery();
}

function disable() {
    hideInfo();
    Mainloop.source_remove(timeout);
}

function txtToMap(str) {
    var params = str.split("\n");
    var dict = new Map();
    for (var i = 0; i < params.length; i++) {
      var parts = params[i].split(":");
      dict.set(parts[0].trim(), parts.length > 1 ? parts[1].trim() : "");
    }
    return dict
}
