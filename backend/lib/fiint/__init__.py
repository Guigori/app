"""FIINT — FINNOS Inteligência.

Canonical entry point for the FINNOS financial intelligence engine.
The existing analyzers remain available during the verified migration.
"""
from .analysis import category_change_analyses

__all__ = ["category_change_analyses"]
