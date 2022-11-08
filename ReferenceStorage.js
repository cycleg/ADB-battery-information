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
    }

    get empty() {
        return this._hash == '';
    }

    getDevDescription(model) {
        var ret = model;
        if (ret in this._reference) {
            let brand = this._reference[ret]["brand"];
            let name = this._reference[ret]["name"];
            ret = brand + ((name !== "") ? " " + name : "");
        }
        return (ret !== "") ? ret : model;
    }

    loadFromCache() {
        const cache = Me.path + GLib.DIR_SEPARATOR_S + ReferenceStorage.DEVICES_DB_FILE;
        var [ok, contents] = GLib.file_get_contents(cache);
        if (ok) {
            let devReference = JSON.parse(contents);
            this._reference = devReference['devices'];
            this._hash = devReference['hash'];
            console.log(
                '[ADB-battery-information] Cached reference loaded from "%s".',
                cache,
            );
        } else {
            console.warn(
                '[ADB-battery-information] Cached reference not loaded from "%s".',
                cache,
            );
        }
    }

    loadRemote() {
        var downloader = new HttpDownloader(null);
        var actionComplete = downloader.head(ReferenceStorage.DEVICES_DB_URL);
        var state = 'checkHash';
        var defReference = {};
        console.log(
            '[ADB-battery-information] Devices reference update from remote resource "%s".',
            ReferenceStorage.DEVICES_DB_URL,
        );
        actionComplete
            .then(function(data) {
                state = (downloader.hash == this._hash) ? 'end' : 'loadFile';
                if (state == 'end') {
                    console.log(
                        '[ADB-battery-information] Remote resource not changed.',
                    );
                }
            })
            .catch(function(err) {
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
                            '[ADB-battery-information] Remote resource download status: %d %s',
                            ReferenceStorage.DEVICES_DB_URL,
                            err.status_code,
                            err.reason_phrase,
                        );
                    } else {
                        console.error('[ADB-battery-information] GET request error %s', err);
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
                state = 'saveFile';
            } catch (err) {
                console.error('[ADB-battery-information] Parse error %s', err);
                state = 'end';
            }
        }
        if (state == 'saveFile') {
            let fout = Gio.File.new_for_path(Me.path + GLib.DIR_SEPARATOR_S + ReferenceStorage.DEVICES_DB_FILE);
            let [ok, etag] = fout.replace_contents(
                JSON.stringify(
                    {
                        'hash': downloader.hash,
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
                this._reference = defReference;
                this._hash = downloader.hash;
                console.log(
                    '[ADB-battery-information] Devices reference updated.',
                );
            } else {
                console.error(
                    "[ADB-battery-information] Can't save to file %s",
                    Me.path + GLib.DIR_SEPARATOR_S + ReferenceStorage.DEVICES_DB_FILE,
                );
            }
            GLib.free(etag);
        }
        console.log(
            '[ADB-battery-information] Devices reference update complete.',
        );
    }
}
