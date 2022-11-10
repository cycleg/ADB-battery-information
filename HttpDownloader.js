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

    get error() {
        return this._error;
    }

    get hash() {
        return this._hash;
    }

    get request() {
        return this._request;
    }

    get running() {
        return this._running;
    }

    _completeJob() {
        if (this._loop) {
            this._loop.quit();
        }
        if (this._success) {
            this._resolve(this);
        } else {
            this._reject(this);
        }
        this._running = false;
    }

    _splice_callback(outputStream, result) {
        try {
            outputStream.splice_finish(result);
            this._data = outputStream.steal_as_bytes();
        } catch (err) {
            this._success = false;
            this._error = err;
        }
        this._completeJob()
    }

    _send_async_callback(session, task) {
        // session == this._httpSession
        let inputStream;
        try {
            inputStream = this._httpSession.send_finish(task);
        } catch (err) {
            this._success = false;
            this._error = err;
            this._completeJob()
            return;
        }
        if (this._request.status_code == Soup.Status.OK) {
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
                try {
                    let outputStream = Gio.MemoryOutputStream.new_resizable();
                    outputStream.splice_async(
                        inputStream,
                        Gio.OutputStreamSpliceFlags.CLOSE_TARGET,
                        GLib.PRIORITY_DEFAULT,
                        null,
                        this._splice_callback.bind(this),
                    );
                } catch (err) {
                    this._success = false;
                    this._error = err;
                    this._completeJob()
                }
            } else {
                this._completeJob()
            }
        } else {
            this._success = false;
            this._completeJob()
        }
    }

    _promiseFunctor(resolve, reject) {
        this._resolve = resolve;
        this._reject = reject;
        if (this._success) {
            this._send();
        } else {
            this._completeJob();
        }
    }

    _prepare(url, method) {
        if (this._running) {
            return null;
        }
        this.reset();
        this._request = Soup.Message.new(method, url);
        if (!this._request) {
            this._success = false;
            this._error = 'bad URL ' + url;
        }
        return new Promise(this._promiseFunctor.bind(this));
    }

    _send() {
        try {
            this._httpSession.send_async(
                this._request,
                null,
                null,
                this._send_async_callback.bind(this),
            );
            this._running = true;
        } catch (err) {
            this._success = false;
            this._error = err;
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
        this._running = false;
    }

    head(url) {
        return this._prepare(url, 'HEAD');
    }

    get(url) {
        return this._prepare(url, 'GET');
    }
}
