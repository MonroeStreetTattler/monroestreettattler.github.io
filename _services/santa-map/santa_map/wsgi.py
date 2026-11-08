"""WSGI entry point for a production host: santa_map.wsgi:application"""

from .app import from_environment

application = from_environment()
