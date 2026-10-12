"""Encrypt a native BSON archive and verify exact recovery without plaintext output.

Produce mongodump in the source environment with a read-only connection. This
module encrypts the archive using a password from the password manager, supplied
via hidden terminal input. It never accepts credentials on command arguments.
"""
import argparse
import getpass
import hashlib
import json
import os
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt
MAGIC=b'FINNOSBACKUP1'


def key(password,salt):
    if len(password)<20:raise ValueError('Use a distinct strong backup password of at least 20 characters')
    return Scrypt(salt=salt,length=32,n=2**15,r=8,p=1).derive(password.encode())


def encrypt(data,password):
    salt,nonce=os.urandom(16),os.urandom(12)
    return MAGIC+salt+nonce+AESGCM(key(password,salt)).encrypt(nonce,data,MAGIC)


def decrypt(data,password):
    if not data.startswith(MAGIC):raise ValueError('Unknown backup version')
    start=len(MAGIC);salt=data[start:start+16];nonce=data[start+16:start+28]
    return AESGCM(key(password,salt)).decrypt(nonce,data[start+28:],MAGIC)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--archive',required=True);parser.add_argument('--output',required=True);args=parser.parse_args()
    source=Path(args.archive).read_bytes()
    password=getpass.getpass('Senha do backup (salve no gerenciador de senhas): ')
    sealed=encrypt(source,password)
    if decrypt(sealed,password)!=source:raise ValueError('Backup recovery verification failed')
    fd=os.open(args.output,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'wb') as handle:handle.write(sealed)
    recovered=decrypt(Path(args.output).read_bytes(),password)
    print(json.dumps({'verified':recovered==source,'archive_sha256':hashlib.sha256(source).hexdigest(),'encrypted_sha256':hashlib.sha256(sealed).hexdigest(),'bytes':len(source),'source_preserved':True}))

if __name__=='__main__':main()
