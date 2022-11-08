'use strict';

const DEVICES_DB_URL = 'https://storage.googleapis.com/play_public/supported_devices.csv';
const DEVICES_DB_FILE = 'devices.json';

const {Gio, GLib} = imports.gi;
imports.gi.versions.Soup = "3.0"; // select version to import
const Soup = imports.gi.Soup;

/*
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const CSV = Me.imports.CSV;
*/
imports.searchPath.push('./');
const HttpDownloader = imports.HttpDownloader.HttpDownloader
const CSV = imports.CSV

var loop = GLib.MainLoop.new(null, false);
var downloader = new HttpDownloader(loop);
var doownloadComplete = downloader.get(DEVICES_DB_URL);
doownloadComplete
    .then(function(data) {
        if (downloader.request.get_method() == 'HEAD') {
            let response_headers = downloader.request.get_response_headers();
            response_headers.foreach((name, value) => {
                console.log('%s: %s', name, value);
            });
        }
        console.log('charset =', downloader.charset);
        console.log('MD5 hash =', downloader.hash);
        if (downloader.request.get_method() == 'GET') {
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
            let defReference = {};
            parsed.mappedRows.forEach(function(row) {
                defReference[row["Model"]] = {
                    'brand': row["﻿Retail Branding"],
                    'name': row["Marketing Name"],
                    'device': row["Device"]
                };
            });
            defReference = {
              'hash': downloader.hash,
              'devices': defReference,
            };
            // Me.path + GLib.DIR_SEPARATOR_S + DEVICES_DB_FILE
            let fout = Gio.File.new_for_path(DEVICES_DB_FILE);
            let [ok, etag] = fout.replace_contents(
                JSON.stringify(defReference, null, 2),
                null,
                false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                null,
            );
            GLib.free(etag);
            console.log('Devices reference updated.')
        }
    })
    .catch(function(err) {
        if (err instanceof Soup.Message) {
            console.error('"%s" download status: %d %s', DEVICES_DB_URL, err.status_code, err.reason_phrase);
        } else {
            console.error(err);
        }
    });
