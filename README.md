# EV-loki (testiversio, versio 1.4)

Sähköauton ajo-, lataus- ja kantamaloki. Popcorn Fuel Login (veneversio 5.2) testiversio: sama kulutusmalli, GPS-kirjaus, arviopisteet ja ehdotusten hyväksyntä, mutta yksiköt ovat km/h, km ja kWh/100 km ja kahden tankin tilalla on yksi akku (varaus %).

## Käyttöönotto
1. Luo GitHubiin uusi repository, esim. `ev-loki` (Public).
2. Lataa tämän paketin kaikki tiedostot repositorion juureen (Add file → Upload files) ja tee Commit. Paketissa ei ole alikansioita, joten sen voi ladata myös iPhonella.
3. Settings → Pages → Source: Deploy from a branch, Branch: `main`, kansio `/ (root)` → Save.
4. Avaa puhelimella `https://<käyttäjätunnus>.github.io/ev-loki/` ja lisää aloitusnäyttöön.

Veneversio ja EV-loki voivat olla samassa puhelimessa: niillä on omat tietokannat, välimuistit ja kieliasetukset.

## Käyttö lyhyesti
- **Akku**: aseta käyttökelpoinen kapasiteetti (oletus 50 kWh) ja alin varaus kantamaa varten (oletus 10 %). Kirjaa varaus % kerran.
- **Ajo**: Aloita ajo → (varaus ennen ajoa) → kuorma. Lopeta ajo → kirjaa varaus % auton näytöltä.
- **Lataus**: varaus ennen ja jälkeen, laturin kWh (valinnainen) ja hinta; paikka Koti tai Latausasema. Lataushäviö lasketaan latauksista.
- **Kulutus**: arviopisteet (km/h → kWh/100 km), sivulaitekuorma (kW), ehdotetut sovitteet; mittauksista tulee ehdotus "Parannettu kulutuskäyrä saatavilla", joka otetaan käyttöön hyväksymällä.
- **Kantama**: tieverkkoa pitkin lämpöhehkuna (versio 1.4) tai ympyränä; latausasemat OpenStreetMapista 100 km:n säteeltä.
- Tuulikerroin (Ilmatieteen laitos) ja kuormakerroin opitaan kuten veneessä. Lämpötilaa ei ole mallissa.

## Versio 1.1
- Tyhjäkäynti (auto päällä paikallaan, esim. lämmitys tai ilmastointi): Ajo-sivulla painike, Lokissa lisäys jälkikäteen. Opettaa sivulaitekuormaa.
- Kaikki sovitteet alkavat nollanopeudessa sivulaitekuormasta; kWh/100 km -kuvaajat alkavat 20 km/h:sta.

## Versio 1.2
- Seuranta sormella kulutuskuvaajissa: nopeus · kulutus ± epävarmuus · kantama.

## Versio 1.3 – akkukäyrä
- Akku-sivulla akkukäyrä (varaus % → kWh) kuten veneen tankkikäyrä: valmistajan kapasiteetti pohjana (±5 %), muoto ja lataushäviöt (koti / latausasema) opitaan latauksista. Uusi käyrä ehdotuksena; aiemmat käyrät palautettavissa.
- Varauskentissä näkyy vaaleanharmaana ennustettu varaus %.

## Versio 1.4 – kantama tieverkkoa pitkin
- Kantama-sivulla Alue: **Tiet** (oletus) tai **Ympyrä**. Tiet-tilassa kantama näkyy lämpöhehkuna ilman erillistä tieviivastoa: vihreä = riittää takaisin, keltainen = käänny takaisin, punainen = vain yhteen suuntaan.
- Jokainen tie ajetaan nopeusrajoituksellaan opitulla kulutuksella (kWh/km sillä nopeudella × kuormakerroin). Reitit ovat nopeimmat, kuten navigaattori ne valitsisi; energia lasketaan niitä pitkin.
- Talvirajoitukset: 120 → 100 ja 100 → 80 km/h. Oletuksena päivämäärän mukaan (25.10.–31.3.), Lisää-sivulla voi pakottaa Kesä/Talvi.
- Kartan napautus: reitti teitä pitkin katkoviivana, km ja kWh. Latausaseman kortissa matka teitä pitkin.
- Tieaineisto (moottoritiet–yhdystiet, OpenStreetMap): rakennetaan GitHubissa "Build road data" -työnkululla kansioon `roads/` ja ladataan sovellukseen kerran (Lisää → Tieaineisto kantamaan → Lataa). Toimii sen jälkeen ilman verkkoa. Ilman aineistoa näytetään ympyrä.

### Tieaineiston rakentaminen (kerran, ja halutessa esim. kerran vuodessa uudelleen)
1. Repositoriossa: Settings → Actions → General → Workflow permissions → **Read and write permissions** → Save.
2. Tiedosto `.github/workflows/build-road-data.yml` (Add file → Create new file, nimeksi koko polku).
3. Actions → **Build road data** → Run workflow. Kestää n. 5–10 min; valmis aineisto tallentuu kansioon `roads/` (meta.json + roads.bin.gz).
4. Sovelluksessa: Lisää → Tieaineisto kantamaan → Lataa / päivitä tieaineisto.
