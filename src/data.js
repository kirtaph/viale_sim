window.VialeData = {};

window.VialeData.tractDefs = {
  D: {
    key:'D', title:'D · Isolati 01-02-03 · via Toti → via Bainsizza',
    description:'Tratto iniziale con intersezione forte lato Toti, attraversamenti ravvicinati e primi innesti sulla pista.',
    image:'./viale_sim_assets/D.png', width:1165, height:296,
    slopes:'5,0% · 2,1% · 0,0% · 0,0%', orientation:'pista in basso · senso unico verso destra',
    carPath:[], bikePath:[], crossings:[], driveways:[], disabled:[], stalls:[], moto:[], sideStreets:[], blockage:null, hotspots:[],
    bugs:['Intersezione iniziale con traffico e attraversamento molto ravvicinati.','Pista bidirezionale già tagliata da accessi sul lato basso.','Attraversamento centrale che sovrappone pedoni, bici e manovre auto.']
  },
  E: {
    key:'E', title:'E · Isolati 03-04-05-06 · via Bainsizza → via Oslavia',
    description:'Sequenza quasi lineare ma con più attraversamenti, aiuole a punta e accessi laterali sulla traiettoria della pista.',
    image:'./viale_sim_assets/E.png', width:1176, height:225,
    slopes:'0,0% · 0,0% · 2,4% · 3,5%', orientation:'pista in basso · senso unico verso destra',
    carPath:[], bikePath:[], crossings:[], driveways:[], disabled:[], stalls:[], moto:[], sideStreets:[], blockage:null, hotspots:[],
    bugs:['Aiuole e punte verdi vicino agli attraversamenti.','Più passi carrabili sul lato della pista bidirezionale.','Nodo Podgora/Solferino carico di micro-conflitti.']
  },
  F: {
    key:'F', title:'F · Isolati 06-07-08-09 · via Oslavia → via F.lli Rosselli',
    description:'Tratto lungo con più laterali e nodo Togliatti molto carico: stalli, attraversamento, area rossa e pista nello stesso punto.',
    image:'./viale_sim_assets/F.png', width:1800, height:373,
    slopes:'3,5% · 3,5% · 4,1% · 5,4%', orientation:'pista in basso · senso unico verso destra',
    carPath:[], bikePath:[], crossings:[], driveways:[], disabled:[], stalls:[], moto:[], sideStreets:[], blockage:null, hotspots:[],
    bugs:['Nodo Togliatti: area rossa, attraversamento, pista e stalli nello stesso punto.','Corsia unica esposta a blocchi se un mezzo si ferma.','Pendenza finale già al 5,4%, con ciclista più lento in risalita.']
  },
  G: {
    key:'G', title:'G · Isolati 09-10-11-12 · via F.lli Rosselli → via di Vittorio',
    description:'Tratto con tante intersezioni e fronte pieno di accessi sul lato della pista. Qui la continuità è molto più grafica che reale.',
    image:'./viale_sim_assets/G.png', width:1798, height:399,
    slopes:'6,2% · 6,5% · 6,3%', orientation:'pista in basso · senso unico verso destra',
    carPath:[], bikePath:[], crossings:[], driveways:[], disabled:[], stalls:[], moto:[], sideStreets:[], blockage:null, hotspots:[],
    bugs:['Pendenze medie > 6%: qui la bici rallenta e la fruibilità cala.','Molti accessi lato basso che tagliano la pista bidirezionale.','Nodo Brodolini con attraversamento e area evidenziata molto critica.']
  },
  H: {
    key:'H', title:'H · Isolati 12-13-14-15 · via di Vittorio → via Ugo La Malfa',
    description:'Tratto più delicato per pendenze elevate, curva del viale, area verde e molti passi carrabili sul lato della pista.',
    image:'./viale_sim_assets/H.png', width:1798, height:470,
    slopes:'8,4% · 8,5% · 8,9%', orientation:'pista in basso · senso unico verso destra',
    carPath:[], bikePath:[], crossings:[], driveways:[], disabled:[], stalls:[], moto:[], sideStreets:[], blockage:null, hotspots:[],
    bugs:['Pendenze medie 8,4%-8,9%: è il tratto normativamente più debole.','Passi carrabili ripetuti proprio sul lato della pista bidirezionale.','Curva, parco e attraversamenti spontanei aumentano i conflitti reali.']
  }
};

window.VialeData.tractOrder = ['D','E','F','G','H'];

window.VialeData.VEHICLE_TYPES = {
  citycar:   {name:'City car',   length:30, width:14, body:'#3b82f6', accent:'#1d4ed8', glass:'#bfdbfe', speedFactor:1.00, accel:32, decel:60, weight:0.55},
  suv:       {name:'SUV',        length:36, width:16, body:'#1e293b', accent:'#0f172a', glass:'#94a3b8', speedFactor:0.95, accel:26, decel:54, weight:0.22},
  van:       {name:'Furgone',    length:48, width:18, body:'#cbd5e1', accent:'#475569', glass:'#94a3b8', speedFactor:0.82, accel:20, decel:46, weight:0.10},
  truck:     {name:'Camioncino', length:54, width:19, body:'#a16207', accent:'#713f12', glass:'#d6d3d1', speedFactor:0.72, accel:16, decel:42, weight:0.05},
  motorbike: {name:'Moto',       length:20, width:9,  body:'#dc2626', accent:'#7f1d1d', glass:'#fecaca', speedFactor:1.18, accel:50, decel:85, weight:0.08}
};

window.VialeData.PROFILES = {
  quiet:   {car: 4,  bike: 2,  ped: 3,  parking: 8},
  morning: {car: 38, bike: 14, ped: 22, parking: 60},
  midday:  {car: 22, bike: 10, ped: 18, parking: 70},
  evening: {car: 45, bike: 12, ped: 28, parking: 50},
  weekend: {car: 28, bike: 18, ped: 32, parking: 35}
};
