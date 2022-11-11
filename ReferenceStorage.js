'use strict';

const {Gio, GLib} = imports.gi;
imports.gi.versions.Soup = "3.0"; // select version to import
const Soup = imports.gi.Soup;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const CSV = Me.imports.CSV;
const HttpDownloader = Me.imports.HttpDownloader.HttpDownloader;

var ReferenceStorage = class ReferenceStorage {
    static DEVICES_DB_URL = 'https://storage.googleapis.com/play_public/supported_devices.csv';
    static DEVICES_DB_FILE = 'devices.json';
    static GSETTINGS_SCHEMA = 'org.gnome.shell.extensions.adb-battery-info';

    constructor() {
        this._reference = {}
        this._hash = '';
        this._updateState = 'end';
    }

    get _cacheFile() {
        return Me.path + GLib.DIR_SEPARATOR_S + ReferenceStorage.DEVICES_DB_FILE;
    }

    get empty() {
        return this._hash == '';
    }

    getDevDescription(model) {
        let ret = model;
        if (ret in this._reference) {
            let brand = this._reference[ret]["brand"];
            let name = this._reference[ret]["name"];
            ret = brand + ((name !== "") ? " " + name : "");
        }
        return (ret !== "") ? ret : model;
    }

    loadFromFile() {
        const cache = this._cacheFile;
        let ok;
        let contents;
        if (!GLib.file_test(cache, GLib.FileTest.IS_REGULAR)) {
            console.log('[ADB-battery-information] Devices reference cache "%s" not found.', cache);
            return
        }
        try {
            [ok, contents] = GLib.file_get_contents(cache);
        } catch(err) {
            console.warn('[ADB-battery-information] Devices reference cache loading error: %s', err);
            return;
        }
        if (ok) {
            let devReference = JSON.parse(contents);
            this._reference = devReference['devices'];
            this._hash = devReference['hash'];
            console.log(
                '[ADB-battery-information] Cached devices reference loaded from "%s".',
                cache,
            );
        } else {
            console.warn(
                '[ADB-battery-information] Cached devices reference not loaded from "%s".',
                cache,
            );
        }
    }

    loadGSettings() {
        let settings = ExtensionUtils.getSettings(ReferenceStorage.GSETTINGS_SCHEMA);
        this._hash = settings.get_string('device-reference-hash');
        this._reference = settings.get_value('device-reference-items').deep_unpack();
    }

    saveGSettings() {
        let settings = ExtensionUtils.getSettings(ReferenceStorage.GSETTINGS_SCHEMA);
        settings.set_string('device-reference-hash', this._hash);
        let devReference = settings.get_value('device-reference-items');
        settings.set_value('device-reference-items', new GLib.Variant(devReference.get_type_string(), this._reference));
        settings.sync();
    }

    _saveFile(hash, devices) {
        let fout = Gio.File.new_for_path(this._cacheFile);
        let [ok, etag] = fout.replace_contents(
            JSON.stringify(
                {
                    'hash': hash,
                    'devices': devices,
                },
                null,
                2,
            ),
            null,
            false,
            Gio.FileCreateFlags.REPLACE_DESTINATION,
            null,
        );
        GLib.free(etag);
        return ok;
    }

    saveFileIfNotExists() {
        if (!GLib.file_test(this._cacheFile, GLib.FileTest.IS_REGULAR)) {
            let ok = this._saveFile(this._hash, this._reference);
            if (!ok) {
                console.error(
                    "[ADB-battery-information] Can't save reference to file %s",
                    Me.path + GLib.DIR_SEPARATOR_S + ReferenceStorage.DEVICES_DB_FILE,
                );
            }
        }
    }

    loadRemote() {
        if (this._updateState != 'end') {
            console.warn(
                '[ADB-battery-information] Devices reference update already running.',
            );
            return;
        }
        console.log(
            '[ADB-battery-information] Devices reference update from remote resource "%s".',
            ReferenceStorage.DEVICES_DB_URL,
        );
        this._updateState = 'checkHash';
        let downloader = new HttpDownloader();
        // simple state machine
        downloader.head(
            ReferenceStorage.DEVICES_DB_URL
        ).then(
            this._smCheckHash.bind(this),
        ).then(
            this._smLoadFile.bind(this),
        ).catch(
            this._smFinalize.bind(this),
        );
    }

    _smCheckHash(downloader) {
        this._updateState = (downloader.hash == this._hash) ? 'end' : 'loadFile';
        if (this._updateState == 'end') {
            console.log(
                '[ADB-battery-information] Remote resource not changed.',
            );
            return new Promise((resolve, reject) => {
                reject(downloader);
            });
        }
        console.log(
            '[ADB-battery-information] Downloading remote resource...',
        );
        return downloader.get(ReferenceStorage.DEVICES_DB_URL);
    }

    _smLoadFile(downloader) {
        let devReference = {};
        console.log(
            '[ADB-battery-information] Remote resource successfully loaded.',
        );
        try {
            const csvDialect = {
                quote: '"',
                separators: ',',
                ignoreSpacesAfterQuotedString: true,
                linefeedBeforeEOF: true,
            };
            let decoder = new TextDecoder(downloader.charset);
            let parsed = CSV.parse(
                decoder.decode(downloader.data.toArray()),
                csvDialect,
            );
            parsed.mappedRows.forEach(function(row) {
                devReference[row["Model"]] = {
                    'brand': row["﻿Retail Branding"],
                    'name': row["Marketing Name"],
                    'device': row["Device"]
                };
            });
            this._updateState = 'saveFile';
        } catch (err) {
            console.error('[ADB-battery-information] Parse error %s', err);
            this._updateState = 'end';
        }
        if (this._updateState == 'saveFile') {
            this._reference = devReference;
            this._hash = downloader.hash;
            let ok = this._saveFile(downloader.hash, devReference);
            if (ok) {
                console.log(
                    '[ADB-battery-information] Devices reference cached.',
                );
            } else {
                console.error(
                    "[ADB-battery-information] Can't save reference to file %s",
                    Me.path + GLib.DIR_SEPARATOR_S + ReferenceStorage.DEVICES_DB_FILE,
                );
            }
            this.saveGSettings();
            this._updateState = 'end';
        }
        return new Promise((resolve, reject) => {
            reject(downloader);
        });
        // ...or simply call
        // _smFinalize(downloader);
    }

    _smFinalize(downloader) {
        if (this._updateState == 'checkHash') {
            if (downloader.error) {
                console.error(
                    '[ADB-battery-information] Check remote resource error: %s',
                    downloader.error,
                );
            } else {
                console.error(
                    '[ADB-battery-information] Remote resource status: %d %s',
                    downloader.request.status_code,
                    downloader.request.reason_phrase,
                );
            }
            this._updateState = 'end';
        }
        if (this._updateState == 'loadFile') {
            if (downloader.error) {
                console.error('[ADB-battery-information] Remote resource loading error: %s', downloader.error);
            } else {
                console.error(
                    '[ADB-battery-information] Remote resource loading status: %d %s',
                    downloader.request.status_code,
                    downloader.request.reason_phrase,
                );
            }
            this._updateState = 'end';
        }
        console.log(
            '[ADB-battery-information] Devices reference update complete.',
        );
    }
}
