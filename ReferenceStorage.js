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
        this._defReference = {
          'hash': '',
          'devices': {},
        };
        this._updated = false;
    }

    get reference() {
        return this._defReference;
    }

    get updated() {
        return this._updated;
    }

    set updated(value) {
        this._updated = value;
    }

    reload(oldHash) {
        var downloader = new HttpDownloader(null);
        var actionComplete = downloader.head(this.DEVICES_DB_URL);
        var state = 'checkHash';
        var defReference = {};
        console.log(
            '[ADB-battery-information] Devices reference update started.',
        );
        actionComplete
            .then(function(data) {
                state = (downloader.hash == oldHash) ? 'end' : 'loadFile';
                if (state == 'end') {
                    console.log(
                        '[ADB-battery-information] "%s" not changed.',
                        this.DEVICES_DB_URL,
                    );
                }
            })
            .catch(function(err) {
                if (err instanceof Soup.Message) {
                    console.error(
                        '[ADB-battery-information] "%s" HEAD status: %d %s',
                        this.DEVICES_DB_URL,
                        err.status_code,
                        err.reason_phrase,
                    );
                } else {
                    console.error('[ADB-battery-information] %s', err);
                }
                state = 'end';
            });
        if (state == 'loadFile') {
            actionComplete = downloader.get(DEVICES_DB_URL);
            actionComplete
                .then(function(data) {
                    state = 'parseFile';
                })
                .catch(function(err) {
                    if (err instanceof Soup.Message) {
                        console.error(
                            '[ADB-battery-information] "%s" download status: %d %s',
                            this.DEVICES_DB_URL,
                            err.status_code,
                            err.reason_phrase,
                        );
                    } else {
                        console.error('[ADB-battery-information] %s', err);
                    }
                    state = 'end';
                });
        }
        if (state == 'parseFile') {
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
                    this._defReference[row["Model"]] = {
                        'brand': row["﻿Retail Branding"],
                        'name': row["Marketing Name"],
                        'device': row["Device"]
                    };
                });
                defReference = {
                  'hash': downloader.hash,
                  'devices': defReference,
                };
                state = 'saveFile';
            } catch (err) {
                console.error('[ADB-battery-information] %s', err);
                state = 'end';
            }
        }
        if (state == 'saveFile') {
            let fout = Gio.File.new_for_path(Me.path + GLib.DIR_SEPARATOR_S + DEVICES_DB_FILE);
            let [ok, etag] = fout.replace_contents(
                JSON.stringify(defReference, null, 2),
                null,
                false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                null,
            );
            if (ok) {
                this._defReference = defReference;
                this._updated = true;
                console.log(
                    '[ADB-battery-information] Devices reference updated.',
                );
            } else {
                console.error(
                    "[ADB-battery-information] Can't save file %s",
                    Me.path + GLib.DIR_SEPARATOR_S + DEVICES_DB_FILE,
                );
            }
            GLib.free(etag);
        }
        console.log(
            '[ADB-battery-information] Devices reference update finished.',
        );
    }
}
