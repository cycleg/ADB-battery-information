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
import CSV from './CSV.mjs';

const loop = GLib.MainLoop.new(null, false);
const _httpSession = new Soup.Session();
// Soup.Session.prototype.add_feature.call(_httpSession, new Soup.ProxyResolverDefault());

var request = new Soup.Message({
    method: 'GET',
    uri: GLib.Uri.parse( DEVICES_DB_URL, GLib.UriFlags.NONE),
});
var charset;
var hash;

function splice_callback(outputStream, result) {
    let data;

    try {
        outputStream.splice_finish(result);
        data = outputStream.steal_as_bytes();
    } catch (err) {
        logError(err);
        loop.quit();
        return;
    }

    const csvDialect = {
        quote: '"',
        separators: ',',
        ignoreSpacesAfterQuotedString: true,
        linefeedBeforeEOF: true,
    };
    let decoder = new TextDecoder(charset);
    // let csv_text = decoder.decode(data.toArray());
    let parsed = CSV.parse(
        decoder.decode(data.toArray()),
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
    loop.quit();
}

function send_async_callback(self, res) {
    let inputStream;

    try {
        inputStream = _httpSession.send_finish(res);
    } catch (err) {
        logError(err);
        loop.quit();
        return;
    }

    console.log('status:', request.status_code, request.reason_phrase);

    const response_headers = request.get_response_headers();
    response_headers.foreach((name, value) => {
        console.log(name, ':', value);
        if ((name == 'x-goog-hash') && (value.split('=')[0] == 'md5')) {
            hash = value.split('=')[1] + '==';
        }
    });
    const lastModified = response_headers.get_one('Last-Modified');
    charset = response_headers.get_one('Content-Type').split('; ')[1].split('=')[1];
    console.log('hash =', hash);
    

    const outputStream = Gio.MemoryOutputStream.new_resizable();
    outputStream.splice_async(
        inputStream,
        Gio.OutputStreamSpliceFlags.CLOSE_TARGET,
        GLib.PRIORITY_DEFAULT,
        null,
        splice_callback,
    );
}

_httpSession.send_async(request, null, null, send_async_callback);

loop.run();
