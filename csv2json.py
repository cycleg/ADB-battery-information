#!/usr/bin/python3

import csv
import json
import sys

# https://storage.googleapis.com/play_public/supported_devices.csv


class DeviceDbCsvDialect(csv.Dialect):
    delimiter = ','
    lineterminator = '\r\n'
    quotechar = '"'
    quoting = csv.QUOTE_MINIMAL
    skipinitialspace = False


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print('Usage: {} <file CSV>'.format(sys.argv[0]))
        sys.exit(1)
    csv_file = sys.argv[1]
    data = dict()
    with open(csv_file, 'r', encoding='utf-16') as fin:
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
    print(json.dumps(data, indent=2))
