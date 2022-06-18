#!/usr/bin/python3

import csv
import io
import json
import sys
import urllib.request
from http import HTTPStatus

DEVICES_DB_URL = 'https://storage.googleapis.com/play_public/supported_devices.csv'
DEVICES_DB_FILE = 'devices.json'


class DeviceDbCsvDialect(csv.Dialect):
    delimiter = ','
    lineterminator = '\r\n'
    quotechar = '"'
    quoting = csv.QUOTE_MINIMAL
    skipinitialspace = False


if __name__ == "__main__":
    data = dict()
    response = urllib.request.urlopen(DEVICES_DB_URL)
    if response.status != HTTPStatus.OK:
        print('HTTP: {} {}'.format(response.status, response.reason))
        sys.exit(1)
    with io.TextIOWrapper(response, encoding='utf-16') as fin:
        reader = csv.reader(fin, dialect=DeviceDbCsvDialect())
        # первая строка
        # Retail Branding,Marketing Name,Device,Model
        row = next(reader, list())
        row = next(reader, list())
        while len(row) > 0:
            data[row[3]] = {
              'brand': row[0],
              'name': row[1],
              'device': row[2],
            }
            row = next(reader, list())
    with open(DEVICES_DB_FILE, 'w', encoding='utf-8') as fout:
        json.dump(data, fout, indent=2)
