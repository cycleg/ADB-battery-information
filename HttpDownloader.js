'use strict';

const {Gio, GLib} = imports.gi;
imports.gi.versions.Soup = "3.0"; // select version to import
const Soup = imports.gi.Soup;

export default class HttpDownloader {
    constructor(loop) {
        this._loop = loop;
        this._httpSession = new Soup.Session();
        this.reset();
    }

    get charset() {
        return this._charset;
    }

    get data() {
        return this._data;
    }

    get hash() {
        return this._hash;
    }

    _loopQuit() {
        if (this._loop) {
            this._loop.quit();
        }
    }

    reset() {
        this._request = null;
        this._httpMethod = '';
        this._charset = '';
        this._hash = '';
        this._data = null;
        this._success = true;
        this._error = null;
    }

    splice_callback(outputStream, result) {
        try {
            outputStream.splice_finish(result);
            this._data = outputStream.steal_as_bytes();
        } catch (err) {
            this._success = false;
            this._error = err;
        }
        this._loopQuit()
    }

    send_async_callback(session, task) {
        // session == this._httpSession
        let inputStream;
        try {
            inputStream = this._httpSession.send_finish(task);
        } catch (err) {
            this._success = false;
            this._error = err;
            this._loopQuit()
            return;
        }
        if (this._request.status_code == 200) {
            let response_headers = this._request.get_response_headers();
            response_headers.foreach((name, value) => {
                if (this._method == 'HEAD') {
                    console.log(name, ':', value);
                }
                if ((name == 'x-goog-hash') && (value.split('=')[0] == 'md5')) {
                    this._hash = value.split('=')[1] + '==';
                }
                if (name == 'Content-Type') {
                    this._charset = value.split('; ')[1].split('=')[1];
                }
            });
            if (this._method == 'GET') {
                // charset = response_headers.get_one('Content-Type').split('; ')[1].split('=')[1];
                let outputStream = Gio.MemoryOutputStream.new_resizable();
                outputStream.splice_async(
                    inputStream,
                    Gio.OutputStreamSpliceFlags.CLOSE_TARGET,
                    GLib.PRIORITY_DEFAULT,
                    null,
                    this.splice_callback.bind(this),
                );
            } else {
                this._loopQuit()
            }
        } else {
            this._success = false;
            this._error = this._request;
            this._loopQuit()
        }
    }

    _send(url) {
        try {
            this._request = new Soup.Message({
                method: this._method,
                uri: GLib.Uri.parse(url, GLib.UriFlags.NONE),
            });
            this._httpSession.send_async(
                this._request,
                null,
                null,
                this.send_async_callback.bind(this),
            );
        } catch (err) {
            this._success = false;
            this._error = err;
        }
        if (this._success && this._loop) {
            this._loop.run();
        }
        return new Promise((resolve, reject) => {
            if (this._success) {
                resolve(true);
            } else {
                reject(this._error);
            }
        });
    }

    head(url) {
        this.reset();
        this._method = 'HEAD';
        return this._send(url);
    }

    get(url) {
        this.reset();
        this._method = 'GET';
        return this._send(url);
    }
}
