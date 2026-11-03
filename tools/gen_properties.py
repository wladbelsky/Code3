"""Regenerate js/properties.js from project.json so the in-browser settings
panel shows exactly the same properties as Wallpaper Engine."""
import json, os
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
props = json.load(open(os.path.join(root, 'project.json'), encoding='utf-8'))['general']['properties']
with open(os.path.join(root, 'js', 'properties.js'), 'w', encoding='utf-8') as f:
    f.write("'use strict';\n/* Generated from project.json by tools/gen_properties.py — do not edit by hand */\n")
    f.write('const WE_PROPERTIES = ' + json.dumps(props, ensure_ascii=False, indent=1) + ';\n')
print('ok', len(props))
