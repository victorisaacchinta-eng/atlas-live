import json, time, urllib.request, urllib.parse
P = [
 ("charminar","Charminar","Hyderabad, India","Charminar, Hyderabad"),
 ("taj","Taj Mahal","Agra, India","Taj Mahal, Agra"),
 ("india-gate","India Gate","New Delhi, India","India Gate, New Delhi"),
 ("gateway","Gateway of India","Mumbai, India","Gateway of India, Mumbai"),
 ("golden-gate","Golden Gate Bridge","San Francisco, USA","Golden Gate Bridge"),
 ("liberty","Statue of Liberty","New York, USA","Statue of Liberty"),
 ("empire","Empire State Building","New York, USA","Empire State Building"),
 ("big-ben","Big Ben","London, UK","Elizabeth Tower, London"),
 ("eiffel","Eiffel Tower","Paris, France","Eiffel Tower"),
 ("colosseum","Colosseum","Rome, Italy","Colosseum, Rome"),
 ("sagrada","Sagrada Família","Barcelona, Spain","Sagrada Familia, Barcelona"),
 ("acropolis","Acropolis","Athens, Greece","Parthenon, Athens"),
 ("hagia","Hagia Sophia","Istanbul, Türkiye","Hagia Sophia, Istanbul"),
 ("burj","Burj Khalifa","Dubai, UAE","Burj Khalifa"),
 ("pyramids","Great Pyramid of Giza","Giza, Egypt","Great Pyramid of Giza"),
 ("opera","Sydney Opera House","Sydney, Australia","Sydney Opera House"),
 ("tokyo-tower","Tokyo Tower","Tokyo, Japan","Tokyo Tower"),
 ("marina-bay","Marina Bay Sands","Singapore","Marina Bay Sands"),
 ("petronas","Petronas Towers","Kuala Lumpur, Malaysia","Petronas Twin Towers"),
 ("christ","Christ the Redeemer","Rio de Janeiro, Brazil","Christ the Redeemer, Rio de Janeiro"),
]
out=[]
for id_,name,city,q in P:
    url="https://nominatim.openstreetmap.org/search?format=json&limit=1&q="+urllib.parse.quote(q)
    req=urllib.request.Request(url,headers={"User-Agent":"ATLAS-Live/0.1 (hackathon; victorisaacchinta@gmail.com)","Accept-Language":"en"})
    j=None
    for attempt in range(4):
        try:
            j=json.load(urllib.request.urlopen(req,timeout=20)); break
        except Exception as e:
            time.sleep(6*(attempt+1))
    if j:
        out.append({"id":id_,"name":name,"city":city,"lat":round(float(j[0]["lat"]),6),"lon":round(float(j[0]["lon"]),6),"osm":j[0].get("display_name","")[:70]})
    else:
        out.append({"id":id_,"name":name,"city":city,"lat":None,"lon":None,"osm":"NOT FOUND"})
    time.sleep(2.5)
for o in out: print(o["id"],o["lat"],o["lon"],"|",o["osm"])
json.dump(out,open("tools/fixtures/presets-geocoded.json","w"),indent=1)
