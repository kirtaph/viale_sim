import urllib.request
import json
import urllib.parse

def get_osm_geometry():
    # Viale Martiri d'Ungheria, Ginosa
    # Bounding box for Ginosa area roughly
    q = '[out:json];way["name"~"Martiri d\'Ungheria"](40.56,16.74,40.59,16.77);out geom;'
    url = 'https://overpass-api.de/api/interpreter?data=' + urllib.parse.quote(q)
    
    req = urllib.request.Request(url, headers={'User-Agent': 'VialeSim/1.0'})
    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read())
            with open('osm_geometry.json', 'w') as f:
                json.dump(data, f, indent=2)
            print("OSM data saved.")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    get_osm_geometry()
