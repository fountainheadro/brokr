# Reguli Proiect - Extracție Date Imobiliare

Acest document conține reglementările oficiale și exhaustive pentru logica de detecție, regulile de clasificare a imaginilor și regulile de completare a câmpurilor formularului CRM din acest proiect.

---

## 🌎 Regulile Generale de Top-Level (Se aplică pentru TOATE Extragerile)

1. **Titlu și Descriere**: 
   - **Fără Numere de Stradă, Blocuri, Scări și Complex Rezidențial**: NICIODATĂ nu adăuga numărul de stradă, denumiri de complexe de blocuri/ansambluri rezidențiale, adrese poștale complete, numere de de bloc, scări, sau apartamente specifice, în titlu ori în descrierea generată (descrierea de marketing sau descrierea CRM). Folosește exclusiv zona/cartierul general.
   - **Titlu Identic și Coerent**: Titlul proprietății din câmpul de titlu dedicat (`crmData.descriere.titlu` sau `title`) trebuie să fie ABSOLUT IDENTIC cu cel afișat în corpul textului de descriere (în `crmData.descriere.continut` și `markdownMarketing`, situat după emojiul 🏡 sau 🏢, de sub linia ID). Folosește exact același algoritm/instrucțiuni pentru a genera titlul în ambele locuri. Structura: Tip imobil + număr camere/încăperi sau suprafață mp | Zonă | Pct. de interes | Pct forte imobil | Dotări | Parcare.
   - **Fără Comision 0%**: Elimină obligatoriu orice mențiune legată de comision zero (ex. "0% comision", "comision 0", "0 euro comision", "fără comisioane").
   - **Șablon Descriere Apartamente și Vile**: Atunci când generezi `descriere` > `descriere` (câmpul de conținut descriere CRM / marketing) pentru categorii de tip **Apartamente** sau **Case / Vile**, folosește cu sfințenie următorul șablon structural. Codul de ID din antet va rămâne gol dacă proprietatea nu are deja un ID atribuit, sau va include ID-ul existent din aplicație a acestei proprietăți (ex. P17246). Respectă cu sfințenie acest format și niciodată să nu te abați de la el.

     *Formatul Șablonului:*
     ```text
     📌 ID [ID_PROPRIETATE_AICI_SAU_GOL]
     🏡 [Titlul identic cu cel din campul de titlu al proprietății]

     [O singură propoziție scurtă tip teaser, de ex: 65 mp utili, balcon mare, parcare inclusă și mutare imediată.]
     [Un scurt paragraf descriptiv al imobilului, de ex: Apartament complet mobilat și utilat, situat în zona Nicolae Teclu, la aproximativ 10 minute de metrou.]

     ━━━━━━━━━━━━━━━━━━

     ⭐ AVANTAJE PRINCIPALE

     -[Compartimentare, ex: -decomandat] (TOATE elementele, de asemenea și compartimentarea, trebuie să înceapă obligatoriu cu dash-ul direct '-')
     -[avantaj_1]
     -[avantaj_2]
     ... (listă cu avantajele principale extrase cu dash prefixat direct, fără spațiu, de tip: -balcon 10 mp)

     ━━━━━━━━━━━━━━━━━━

     🛋️ DOTĂRI

     -[dotare_1]
     -[dotare_2]
     ... (listă cu dotările identificate cu dash prefixat direct, de tip: -centrală proprie)

     [Scurt comentariu de text / rezumat opțional referitor la organizarea fizică a spațiului, de ex: Spațiul este foarte bine organizat și oferă mult loc pentru depozitare comparativ cu majoritatea apartamentelor similare.]

     ━━━━━━━━━━━━━━━━━━

     📍 LOCAȚIE

     Acces rapid către:
     -[punct_interes_1]
     -[punct_interes_2]
     ... (listă puncte de interes / proximități cu dash prefixat direct, de tip: -metrou Nicolae Teclu)

     ━━━━━━━━━━━━━━━━━━

     💰 ÎNCHIRIERE (sau VÂNZARE în funcție de tipul tranzacției)

     [Preț] / lună (pentru Închiriere, ex: 599€ / lună) sau [Preț] (pentru Vânzare)
     [Garanție] (pentru Închiriere, ex: 1 lună garanție)
     Comision [Comision] (ex: Comision 50% + TVA)
     Disponibil imediat (sau disponibilitate detectată)

     ━━━━━━━━━━━━━━━━━━

     🤝 SUPORT ÎNCHIRIERE (sau SUPORT VÂNZARE)

     -consultanță dedicată din partea agenției brokr
     -asistență completă în întocmirea contractului și înregistrarea ANAF
     -posibilitate de vizionare rapidă și flexibilă

     📞 Pentru vizionare sau detalii suplimentare, contactează-ne telefonic.
     ```

    - **Șablon Descriere Birouri, Spații Magazine/Comerciale și Spații Industriale**: Atunci când generezi `descriere` > `descriere` pentru categorii de tip **Birouri**, **Spatii comerciale** (magazine) sau **Spatii industriale**, folosește cu sfințenie următorul șablon structural. Codul de ID din antet va rămâne gol dacă proprietatea nu are un ID sau va folosi ID-ul existent. **NOTĂ IMPORTANTĂ**: NICIODATĂ nu păstra parantezele rotunde sau pătrate atunci când generezi textul final în anunțuri - parantezele arată doar că există mai multe variante posibile sau mai multe exemple, din care tu, ca AI, trebuie să o alegi pe cea mai potrivită exclusiv pe baza proprietății date, eliminând complet parantezele.

      *Formatul Șablonului:*
      ```text
      📌 ID Proprietate: [ID_PROPRIETATE_AICI_SAU_GOL]
      🏢 [Nume_Sau_Titlu_Proprietate]

      Spațiu comercial pregătit pentru activitate, situat în [Zona_Accent, ex: Timpuri Noi], cu acces rapid, expunere bună și configurare eficientă pentru multiple tipuri de business.

      Potrivit pentru retail, showroom, office, clinică, beauty, servicii sau activități comerciale mixte.

      ━━━━━━━━━━━━━━━━━━

      ⭐ PUNCTE CHEIE

      - [Suprafata_Utila] mp utili
      - [Compartimentare / Structura, ex: open spaces și 2 cabinete]
      - vizibilitate comercială foarte bună
      - acces facil pentru clienți și aprovizionare
      - trafic zonal [Nivel_Trafic, ex: intens]
      - disponibil imediat
      - flexibil pentru multiple activități
      - poziționare strategică în zonă activă

      ━━━━━━━━━━━━━━━━━━

      🛠️ SPAȚIUL

      - [Număr_Compartimente / Camere] încăperi
      - [Număr_Băi] băi
      - etaj [Etaj] / [Total_Etaje_Clădire]
      - lift: [da sau nu, în funcție de datele proprietății, ex: da]
      - balcon / terasă: [da/nu sau detalii extra, ex: terasă 12 mp]
      - bucătărie: [detalii sau nespecificată]
      - mobilare: [detalii, ex: nemobilat, doar bucătăria utilată]

      Dotări și infrastructură:

      - [detalii climatizare, ex: centrală proprie și climatizare HVAC]
      - [curent trifazic, menționează-l doar dacă este prezent sau confirmat în text, altfel scoate rândul, ex: curent trifazic]
      - [internet de mare viteză sau elimină dacă nu e specificat]
      - [detalii securitate, ex: alarmă și supraveghere video sau doar alarmă, etc.]
      - [detalii ventilație, ex: sistem de ventilație]
      - [menționează rampă/lift marfă dacă există sau scoate rândul]
      - [detalii depozitare / curte / acces secundar, ex: acces separat marfă și spațiu depozitare]

      Spațiul permite organizare eficientă și adaptare rapidă pentru diferite tipuri de activitate.

      ━━━━━━━━━━━━━━━━━━

      📍 LOCAȚIE & ACCES

      Situat în [Zona_Accent, ex: Timpuri Noi], cu acces rapid către:

      - transport public
      - zone office & comerciale
      - artere principale
      - zone rezidențiale
      - trafic pietonal și auto

      Vad comercial: [Expunere, ex: excelentă sau pietonal intens]
      Trafic zonă: [Nivel_Trafic, ex: pietonal mediu și auto intens]

      ━━━━━━━━━━━━━━━━━━

      💼 POTRIVIT PENTRU

      - retail / showroom
      - clinică / cabinet
      - beauty / wellness
      - office / consultanță
      - horeca
      - servicii comerciale
      - activități mixte

      ━━━━━━━━━━━━━━━━━━

      💼 CONDIȚII ÎNCHIRIERE (sau CONDIȚII VÂNZARE)

      - chirie: [Preț_Chirie, ex: 1500 € / lună + TVA sau chirie scutită de TVA] / pentru Vânzare: - preț: [Preț]
      - garanție: [Garanție, ex: 2 luni] (dacă este închiriere)
      - disponibilitate: [imediată sau dată]
      - contract minim: [perioadă, ex: 12 luni sau nespecificat]
      - destinație acceptată: [ex: office / comercial / mixt]

      Condiții suplimentare:
      [perioadă grație / amenajare / contribuție owner sau se lasă gol / se elimină detalii dacă nu sunt menționate]

      ━━━━━━━━━━━━━━━━━━

      🤝 SUPORT ÎNCHIRIERE (sau SUPORT VÂNZARE)

      - consultanță dedicată din partea agenției brokr
      - suport negociere și contractare
      - analiză compatibilitate activitate
      - posibilitate de vizionare rapidă și flexibilă

      📞 Pentru vizionare sau detalii suplimentare, contactează-ne telefonic.
      ```

2. **Opțiuni Dropdown/Select**: NICIODATĂ nu inventa sau nu introduce valori care nu sunt standard în schema sau în opțiunile definite de cod. Dacă nicio valoare standard nu se potrivește, selectează opțiunea goală `""`.
3. **Calcule Automate de Suprafață**:
   - **Suprafață Construită**: Pentru categoriile "Apartamente" și "Case / Vile", suprafața construită se calculează automat ca exact `Suprafață utilă * 1.2`. Pentru alte categorii (comerciale, birouri, etc.), se folosește multiplicatorul `1.1`.
   - **Suprafață Utilă Totală**: Se calculează automat ca `Suprafață utilă + Suprafață balcoane + Suprafață terase` (dacă sunt prezente/menționate).
4. **Cerințe Imagini**: Se vor extrage exclusiv fotografiile originale de înaltă rezoluție. Ignoră sau filtrează logo-urile, iconițele, thumbnail-urile mici sau imaginile pur textuale.
5. **Deduplicare Vizuală**: Identifică imaginile duplicat (aceeași scenă vizualizată din același unghi) și păstrează exclusiv versiunea de rezoluție maximă.

---

## 📑 Clasificarea Câmpurilor Formularului în funcție de Structura UI

### 🧱 1. Accordion / Găleată: Caracteristici

#### A. Secțiunea: Suprafețe
* **Balcoane (`caracteristici.suprafete.balcoane`) & Terase (`caracteristici.suprafete.terase`)**:
  - Se completează DOAR dacă sunt menționate explicit în textul sau în URL-ul proprietății.
  - Dacă se menționează doar un simplu număr de balcoane (de ex. "1 balcon") sau o valoare singulară, completează exclusiv câmpul de **Balcoane**, NIMIC în câmpul de **Terase**.
  - Se completează ambele câmpuriDOAR dacă sunt menționate distinct, separat și ca spații individualizate în textul proprietății.

#### B. Secțiunea: Clădire
* **Stadiu Construcție (`caracteristici.alteDetalii.stadiuConstructie`)**:
  - Valoarea implicită este **"Finalizata"** în cazul în care nu se specifică alt stadiu în mod explicit în text sau URL-ul proprietății.
* **Tip Imobil (`caracteristici.alteDetalii.tipImobil`)**:
  - Prima opțiune predefinită în listă este **"Bloc"** (urmată de "Casa/Vila", "Bloc garsoniere", "Bloc Mixt").
* **Sistem Încălzire (`utilitati.sistemIncalzire`)**:
  - Pentru apartamente, bifează obligatoriu **Termoficare**, **Centrala proprie** sau **Centrala imobil** (cel puțin una) pe baza descrierii sau imaginilor:
    - **Centrala proprie**: Bifează dacă vezi o centrală de apartament (cutie metalică pe perete de obicei plasată în bucătărie sau în baie) sau dacă este descrisă ca "centrală proprie".
    - **Centrala imobil**: Bifează dacă scrie explicit "centrală de bloc" sau "centrală de imobil".
    - **Termoficare**: Bifează dacă se specifică termoficare/sistem centralizat sau dacă în imagini/text apar repartitoare sau contoare speciale aplicate pe calorifere.

---

### 💧 2. Accordion / Găleată: Utilități

#### A. Secțiunea: General
* **Cabluri / Internet**:
  - Opțiunea **"Acces internet"** și toate derivațiile sale (precum "Cablu", "Fibra optica", "Wireless", "Dial-up") au fost **ELIMINATE COMPLET** din baza de date și din UI. Nu le selecta și nu le extrage niciodată în general.
* **Utilități Standard (Curent, Apă, Canalizare, Gaz etc.)**:
  - Bifează exclusiv ceea ce este dovedit explicit prin text sau evidențiat în imagini. Nu presupune fără mențiune.

#### B. Secțiunea: Climatizare
* **Aer Condiționat**:
  - Bifează opțiunea doar dacă detectezi vizual un aparat de aer condiționat montat pe perete în fotografii sau dacă este menționat în descriere.

---

### 🎨 3. Accordion / Găleată: Finisaje

#### A. Secțiunea: Pereți
* **Vopsea Lavabilă**:
  - Dacă pereții sunt simpli, zugrăviți într-o culoare solidă sau albă în fotografii, se bifează automat opțiunea **"Vopsea lavabila"**.
* **Faianță**:
  - Se bifează pentru bucătărie și băi dacă în descriere sau în poze apar plăci ceramice specifice (faiantă).

#### B. Secțiunea: Podele
* **Parchet / Gresie / Marmură**:
  - Bifează materialele identificate vizual: de ex. parchet în camere, gresie/marmură în holuri, bucătării și băi.

#### C. Secțiunea: Ușă Intrare & Uși Interior
* **Ușă Intrare**:
  - Detetează materialul ușii principale (de regulă "Metal" dacă are textură specifică de metal/antiefractie sau "Lemn" / "PVC").
* **Uși Interior**:
  - Bifează tipul/materialul dedus din imagini sau din descriere (Lemn, Celulare, Sticla etc.).

#### D. Secțiunea: Jaluzele & Rulouri & Izolații
* Bifează opțiunile corespunzătoare doar dacă sunt clar evidențiate în descriere sau vizibile la ferestre (ex: jaluzele orizontale/verticale, rulouri exterioare de aluminiu, izolație exterioară/interior).

---

### 🔌 4. Accordion / Găleată: Dotări

#### A. Secțiunea: Mobilat
* Setează stadiul corect pe baza imaginilor din camere și living: "Complet", "Partial", "Nemobilat", "Lux", "Modern".

#### B. Secțiunea: Bucătărie
* **Mobilata**:
  - Bifează dacă din descriere sau din poze reiese clar prezența corpurilor de mobilier în bucătărie (corpuri suspendate, blat de lucru, dulapuri).
* **Utilata**:
  - Bifează împreună cu dotările relevante dacă în poze sau în text apar electrocasnice funcționale (cuptor, plită, aragaz, frigider, hota sau cuptor cu microunde).

#### C. Secțiunea: Contorizare
* **Apometre**: Bifează dacă proprietatea are alimentare cu apă curentă (apă caldă/rece demonstrată).
* **Contor gaz**: Bifează dacă este prezent gazul / branșamentul de gaz.
* **Contor curent electric**: Bifează dacă proprietatea este racordată la energie electrică.
* **Contor caldura**: Bifează dacă apare termenul "termoficare" în descriere, sau dacă vezi contoare ori repartitoare aplicate pe calorifere în text/imagini.

#### D. Secțiunea: Electrocasnice
* Bifează precis dotările electrocasnice observate exclusiv vizual în fotografii sau demonstrate în text: Mașină de spălat rufe, Frigider, Aragaz, Mașină de spălat vase, TV, Microunde, Plită, Hotă, Încălzitor cafea etc.

#### E. Secțiunea: Priveliște
* **Panoramica**:
  - Se bifează DOAR dacă în descrierea textuală sau în poze se demonstrează că proprietatea oferă vizibilitate largă, deschisă pe cel puțin 3 laturi/puncte cardinale diferite.
* **Lac**:
  - Se bifează dacă un lac, râu sau corp de apă important este menționat direct în descriere sau se vede clar din ferestre/balcon în poze.
* **Spre oras**:
  - Această opțiune este extrem de des bifează adesea (aproape întotdeauna), deoarece ferestrele apartamentelor din orașe oferă în mod implicit vedere directă către peisajul urban.
* **Alte priveliști**: Bifează doar dacă sunt confirmate clar (ex. Pădure, munte, parc).

---

### 💰 5. Accordion / Găleată: Preț

#### A. Secțiunea: Detalii Preț
* **Avans (`pret.detalii.avans`)**:
  - Se completează pe baza informațiilor găsite despre proprietate la URL.
  - Dacă se specifică o formă de plată în avans exprimată în luni, cum ar fi **"1 lună avans"**, **"avans 1 lună"**, **"avans o lună"** sau similar, se calculează automat valoarea reprezentând `Număr de luni * Preț lunar chirie` și se completează acea sumă numerică finală (ex: chirie de 500€ per lună cu 1 lună avans => 500, sau cu 2 luni avans => 1000).
  - Dacă se menționează direct o sumă specifică de bani fixă pentru avans în loc de număr de luni (ex: "avans 450 euro"), se completează direct acea valoare numerică.
* **Garanție (`pret.detalii.garantie`)**:
  - Se completează pe baza informațiilor de garanție / depozit identificate la URL.
  - Dacă se menționează o garanție exprimată în luni, cum ar fi **"1 lună garanție"**, **"garanție 1 lună"**, **"depozit 1 lună"**, **"o lună garanție"** sau similar, se calculează automat valoarea reprezentând `Număr de luni * Preț lunar chirie` și se completează acea sumă numerică (ex: chirie de 500€ per lună cu 1 lună garanție => 500).
  - Dacă se specifică direct o sumă fixă de bani pentru garanție / depozit (ex: "garanție/depozit 1000 euro"), se completează direct acea valoare numerică.

---

## 📸 Categorisire Imagini (Reguli Vizuale)

Când asociezi imaginile pe categorii în JSON, aplică riguros următoarele criterii de design:

* **Living**: 
  - *Identificare*: Canapele, fotolii, masă de cafea, televizor montat pe perete sau pe un corp de mobilă specific.
  - *Excepție*: Dacă proprietatea este de tip **Studio / Garsonieră**, prezența unui pat în camera principală clasifică imaginea tot ca **Living** (deoarece acea unică încăpere servește drept spațiu principal de zi).
* **Dormitor**: 
  - *Identificare*: Pat matrimonial/single, noptiere, dressing sau șifonier.
  - *Filtrare*: Se folosește aceasă categorie DOAR dacă proprietatea **NU** este de tip studio/garsonieră (cum s-a menționat în excepția de mai sus).
* **Bucătărie**: 
  - *Identificare*: Blat de lucru, dulapuri suspendate pentru vase, chiuvetă din inox, electrocasnice încorporate sau libere (aragaz, plită, cuptor, frigider, etc.).
* **Baie**: 
  - *Identificare*: Vas de toaletă (WC), bideu, cadă sau cabină de duș, oglindă, gresie și faianță specifice băii, geam mic de aerisire.
* **Alte Spații**: 
  - *Identificare*: Holuri de acces, exteriorul clădirii/blocului, curte, grădină exterioară, balcon, garaj, parcare, planuri/schițe tehnice, vederi panoramice din exterior.

---

## 🎨 Specificații Interfață / UI (Prezentarea Datelor)

- **Download Individual**: Fiecare imagine din tabelele din UI suportă buton dedicat de descărcare.
- **Download Colectiv**: Buton special plasat pe rândul categoriei dă posibilitatea de a descărca simultan toate imaginile din categoria respectivă (ex. Living, Bucătărie etc.).
- **Redimensionare**: Imaginile din tabele sunt setate vizual la o dimensiune fixă reprezentând aproximativ **20%** din lățimea tabelului pentru o lectură comodă.
- **Interactivitate**: La un simplu click pe oricare imagine, aceasta se deschide automat într-un tab nou de browser în formatul ei original.
