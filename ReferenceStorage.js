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

    constructor() {
        this._reference = {}
        this._hash = '';
        this._updateState = 'end';
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

    loadFromCache() {
        const cache = Me.path + GLib.DIR_SEPARATOR_S + ReferenceStorage.DEVICES_DB_FILE;
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
        let downloader = new HttpDownloader(null);
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
            '[ADB-battery-information] Downloading remote resource.',
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
            let fout = Gio.File.new_for_path(Me.path + GLib.DIR_SEPARATOR_S + ReferenceStorage.DEVICES_DB_FILE);
            let [ok, etag] = fout.replace_contents(
                JSON.stringify(
                    {
                        'hash': downloader.hash,
                        'devices': devReference,
                    },
                    null,
                    2,
                ),
                null,
                false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                null,
            );
            if (ok) {
                this._reference = devReference;
                this._hash = downloader.hash;
                console.log(
                    '[ADB-battery-information] Devices reference saved.',
                );
            } else {
                console.error(
                    "[ADB-battery-information] Can't save to file %s",
                    Me.path + GLib.DIR_SEPARATOR_S + ReferenceStorage.DEVICES_DB_FILE,
                );
            }
            GLib.free(etag);
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
