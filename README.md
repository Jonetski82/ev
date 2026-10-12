# EV-loki (testiversio, versio 1.0)

Sähköauton ajo-, lataus- ja kantamaloki. Popcorn Fuel Login (veneversio 5.2) testiversio: sama kulutusmalli, GPS-kirjaus, arviopisteet ja ehdotusten hyväksyntä, mutta yksiköt ovat km/h, km ja kWh/100 km ja kahden tankin tilalla on yksi akku (varaus %).

## Käyttöönotto
1. Luo GitHubiin uusi repository, esim. `ev-loki` (Public).
2. Lataa tämän paketin kaikki tiedostot ja kansiot repositorion juureen (Add file → Upload files) ja tee Commit.
3. Settings → Pages → Source: Deploy from a branch, Branch: `main`, kansio `/ (root)` → Save.
4. Avaa puhelimella `https://<käyttäjätunnus>.github.io/ev-loki/` ja lisää aloitusnäyttöön.

Veneversio ja EV-loki voivat olla samassa puhelimessa: niillä on omat tietokannat, välimuistit ja kieliasetukset.

## Käyttö lyhyesti
- **Akku**: aseta käyttökelpoinen kapasiteetti (oletus 50 kWh) ja alin varaus kantamaa varten (oletus 10 %). Kirjaa varaus % kerran.
- **Ajo**: Aloita ajo → (varaus ennen ajoa) → kuorma. Lopeta ajo → kirjaa varaus % auton näytöltä.
- **Lataus**: varaus ennen ja jälkeen, laturin kWh (valinnainen) ja hinta; paikka Koti tai Latausasema. Lataushäviö lasketaan latauksista.
- **Kulutus**: arviopisteet (km/h → kWh/100 km), sivulaitekuorma (kW), ehdotetut sovitteet; mittauksista tulee ehdotus "Parannettu kulutuskäyrä saatavilla", joka otetaan käyttöön hyväksymällä.
- **Kantama**: ympyränä kartalla nykyisellä ja taloudellisimmalla nopeudella; latausasemat OpenStreetMapista 100 km:n säteeltä.
- Tuulikerroin (Ilmatieteen laitos) ja kuormakerroin opitaan kuten veneessä. Lämpötilaa ei ole mallissa.
