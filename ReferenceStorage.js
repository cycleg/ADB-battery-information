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
        this._downloader = null;
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
        let [ok, contents] = GLib.file_get_contents(cache);
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
        this._downloader = new HttpDownloader(null);
        let actionComplete = this._downloader.head(ReferenceStorage.DEVICES_DB_URL);
        actionComplete.then(
            this._onHashCheck.bind(this),
            this._onError.bind(this),
        );
    }

    _onHashCheck(data) {
        this._updateState = (this._downloader.hash == this._hash) ? 'end' : 'loadFile';
        if (this._updateState == 'end') {
            console.log(
                '[ADB-battery-information] Remote resource not changed.',
            );
            _onLoadRemoteFinalize();
        } else {
            let actionComplete = this._downloader.get(ReferenceStorage.DEVICES_DB_URL);
            actionComplete.then(
                this._onFileLoaded.bind(this),
                this._onError.bind(this),
            );
        }
    }

    _onFileLoaded(data) {
        let defReference = {};
        try {
            const csvDialect = {
                quote: '"',
                separators: ',',
                ignoreSpacesAfterQuotedString: true,
                linefeedBeforeEOF: true,
            };
            let decoder = new TextDecoder(this._downloader.charset);
            let parsed = CSV.parse(
                decoder.decode(this._downloader.data.toArray()),
                csvDialect,
            );
            parsed.mappedRows.forEach(function(row) {
                defReference[row["Model"]] = {
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
                        'hash': this._downloader.hash,
                        'devices': defReference,
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
                this._hash = this._downloader.hash;
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
        _onLoadRemoteFinalize();
    }

    _onError(err) {
        if (this._updateState == 'checkHash') {
            if (err instanceof Soup.Message) {
                console.error(
                    '[ADB-battery-information] "%s" HEAD status: %d %s',
                    ReferenceStorage.DEVICES_DB_URL,
                    err.status_code,
                    err.reason_phrase,
                );
            } else {
                console.error('[ADB-battery-information] HEAD request error %s', err);
            }
        }
        if (this._updateState == 'loadFile') {
            if (err instanceof Soup.Message) {
                console.error(
                    '[ADB-battery-information] Remote resource download status: %d %s',
                    ReferenceStorage.DEVICES_DB_URL,
                    err.status_code,
                    err.reason_phrase,
                );
            } else {
                console.error('[ADB-battery-information] GET request error %s', err);
            }
        }
        this._updateState = 'end';
        _onLoadRemoteFinalize();
    }

    _onLoadRemoteFinalize() {
        this._downloader = null;
        console.log(
            '[ADB-battery-information] Devices reference update complete.',
        );
    }
}
