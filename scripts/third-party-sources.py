"""Fetch verified upstream sources and prepare the companion distribution (Python 3.11+)."""
import argparse
import concurrent.futures
import hashlib
import json
from pathlib import Path
import re
import tarfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent.parent
LICENSES = ROOT / 'vendor/native-licenses'
MANIFEST = json.loads((LICENSES / 'sources.json').read_text(encoding='utf-8'))
CACHE = ROOT / '.inspection/native-sources'
ENTRIES = sum((MANIFEST[k] for k in ('sources', 'rustSources', 'buildSources')), [])


def digest(data):
    return hashlib.sha256(data).hexdigest()


def source(entry, download=False):
    path = CACHE / entry['file']
    if path.exists() and digest(path.read_bytes()) == entry['sha256']:
        return path
    if not download:
        raise RuntimeError(f"Missing or changed source: {entry['file']}; run with --download")
    errors = []
    for url in entry['urls']:
        try:
            request = urllib.request.Request(url, headers={'User-Agent': 'Atwiki-Editor-source-distribution'})
            with urllib.request.urlopen(request, timeout=60) as response:
                data = response.read()
            if digest(data) != entry['sha256']:
                raise ValueError('SHA-256 mismatch')
            path.write_bytes(data)
            return path
        except Exception as error:
            errors.append(f'{url}: {error}')
    raise RuntimeError('\n'.join(errors))


def notices():
    # Include a superset of source notices; Cargo.lock also contains build/test
    # dependencies. This is not a claim that every listed crate is in the DLL.
    sections = []
    for entry in ENTRIES:
        sections.append(f"\n{'=' * 72}\n{entry['name']} {entry['version']}\nSource: {entry['urls'][0]}\nSHA-256: {entry['sha256']}\n")
        count = 0
        with tarfile.open(source(entry)) as archive:
            for member in archive:
                leaf = Path(member.name).name
                if not member.isfile() or member.size > 500_000:
                    continue
                if not re.match(r'^(licen[sc]e|copying|copyright|notice|authors|patents|ftl\.txt)([.\-_]|$)', leaf, re.I):
                    continue
                data = archive.extractfile(member).read()
                if b'\0' in data:
                    continue
                sections.append(f'\n--- {member.name} ---\n' + data.decode('utf-8', errors='replace'))
                count += 1
        if not count:
            # Some crates publish only their SPDX declaration and source headers.
            # Preserve those declarations verbatim; standard texts are alongside.
            with tarfile.open(source(entry)) as archive:
                for member in archive:
                    if member.isfile() and member.size < 100_000 and Path(member.name).name in ('Cargo.toml', 'README.md', 'lib.rs', 'build.sh'):
                        sections.append(f'\n--- {member.name} ---\n' + archive.extractfile(member).read().decode('utf-8', errors='replace'))
                        count += 1
            if not count:
                raise RuntimeError(f"No notice or declaration found in {entry['file']}")
    (LICENSES / 'UPSTREAM-NOTICES.txt').write_text('\n'.join(sections), encoding='utf-8')


def bundle():
    version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
    output = ROOT / f'atwiki-editor-{version}-third-party-sources.zip'
    documents = [p for p in sorted(LICENSES.iterdir()) if p.is_file()]
    documents += [ROOT / 'docs/third-party-licenses.md', Path(__file__)]
    # The entries themselves are compressed archives. Preserve them byte-for-byte.
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_STORED) as archive:
        for entry in ENTRIES:
            archive.write(source(entry), 'sources/' + entry['file'])
        for path in sorted(LICENSES.iterdir()):
            if path.is_file():
                archive.write(path, 'licenses/' + path.name)
        archive.write(ROOT / 'docs/third-party-licenses.md', 'README.md')
        archive.write(Path(__file__), 'scripts/third-party-sources.py')
    output.with_suffix('.zip.sha256').write_text(f'{digest(output.read_bytes())}  {output.name}\n', encoding='ascii')
    receipt = {'version': version, 'archive': output.name, 'documents': {
        p.relative_to(ROOT).as_posix(): digest(p.read_bytes()) for p in documents
    }}
    (ROOT / '.inspection/source-distribution.json').write_text(json.dumps(receipt, indent=2)+'\n', encoding='utf-8')
    print(f'Created {output.name}: {len(ENTRIES)} verified source archives, {output.stat().st_size} bytes')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--download', action='store_true')
    parser.add_argument('--notices', action='store_true', help='Regenerate notices from verified archives')
    args = parser.parse_args()
    CACHE.mkdir(parents=True, exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(lambda entry: source(entry, args.download), ENTRIES))
    if args.notices:
        notices()
    bundle()
