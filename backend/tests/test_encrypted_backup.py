import importlib.util
from pathlib import Path
import pytest
from cryptography.exceptions import InvalidTag
spec=importlib.util.spec_from_file_location('backup',Path(__file__).parents[1]/'scripts/encrypted_backup.py');b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)

def test_encrypted_archive_recovers_exactly_and_rejects_tampering():
    source=b'BSON synthetic fixture\x00\xff';password='synthetic-test-password-only-2026'
    result=b.encrypt(source,password)
    assert source not in result and b.decrypt(result,password)==source
    with pytest.raises(InvalidTag):b.decrypt(result,'another-synthetic-password-2026')
    with pytest.raises(InvalidTag):b.decrypt(result[:-1]+bytes([result[-1]^1]),password)
