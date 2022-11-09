'use strict';

const {Gio, GLib} = imports.gi;
imports.gi.versions.Soup = "3.0"; // select version to import
const Soup = imports.gi.Soup;

var HttpDownloader = class HttpDownloader {
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

    get request() {
        return this._request;
    }

    _loopQuit() {
        if (this._loop) {
            this._loop.quit();
        }
        if (this._success) {
            this._resolve(true);
        } else {
            this._reject(this._error);
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
        this._resolve = null;
        this._reject = null;
    }

    _splice_callback(outputStream, result) {
        try {
            outputStream.splice_finish(result);
            this._data = outputStream.steal_as_bytes();
        } catch (err) {
            this._success = false;
            this._error = err;
        }
        this._loopQuit()
    }

    _send_async_callback(session, task) {
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
                if ((name == 'x-goog-hash') && (value.split('=')[0] == 'md5')) {
                    this._hash = value.split('=')[1] + '==';
                }
                if (name == 'Content-Type') {
                    this._charset = value.split('; ')[1].split('=')[1];
                }
            });
            if (this._request.get_method() == 'GET') {
                // charset = response_headers.get_one('Content-Type').split('; ')[1].split('=')[1];
                let outputStream = Gio.MemoryOutputStream.new_resizable();
                outputStream.splice_async(
                    inputStream,
                    Gio.OutputStreamSpliceFlags.CLOSE_TARGET,
                    GLib.PRIORITY_DEFAULT,
                    null,
                    this._splice_callback.bind(this),
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

    _promiseFunctor(resolve, reject) {
        this._resolve = resolve;
        this._reject = reject;
    }

    _send(url, method) {
        this.reset();
        try {
            this._request = new Soup.Message({
                method: method,
                uri: GLib.Uri.parse(url, GLib.UriFlags.NONE),
            });
            this._httpSession.send_async(
                this._request,
                null,
                null,
                this._send_async_callback.bind(this),
            );
        } catch (err) {
            this._success = false;
            this._error = err;
        }
        return new Promise(this._promiseFunctor.bind(this));
    }

    head(url) {
        return this._send(url, 'HEAD');
    }

    get(url) {
        return this._send(url, 'GET');
    }
}
