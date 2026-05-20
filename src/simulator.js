(async () => {
  const stage = document.getElementById('stage');
  const ctx = stage.getContext('2d');
  const ui = {};
  ['tractSelect','scenarioSelect','profileSelect','carFlow','bikeFlow','pedFlow','parkingFlow','parkingFill',
   'carFlowVal','bikeFlowVal','pedFlowVal','parkingFlowVal','parkingFillVal',
   'showImage','showHotspots','showPaths','showStalls','showLabels','debugMode',
   'pauseBtn','resetBtn','tractTitle','tractDescription',
   'slopeChip','orientationChip','scenarioChip','stallsChip',
   'bugList','logBox',
   'statCrashes','statBrakes','statNearMisses','statParked','statParkedSub','statThrough','statThroughSub',
   'hudCO2','hudActive','hudSpeed','scenarioGrid',
   'badgeSimulationStatus','badgeActiveTract','badgeNearMisses','openOnboardingBtn','firstVisitModal','closeModalBtn','closeModalCrossBtn'
  ].forEach(k => ui[k] = document.getElementById(k));

  const { tractDefs, tractOrder, VEHICLE_TYPES, PROFILES } = window.VialeData;
  const VEHICLE_KEYS = Object.keys(VEHICLE_TYPES);
  const imageCache = {};

  function pickVehicleType(){
    const r = Math.random();
    let acc = 0;
    for(const k of VEHICLE_KEYS){
      acc += VEHICLE_TYPES[k].weight;
      if(r < acc) return k;
    }
    return 'citycar';
  }

  async function loadCalibrationData() {
    let fileData = null;
    try {
      const res = await fetch('viale_calibration.json?' + Date.now());
      if (res.ok) {
        fileData = await res.json();
        tractOrder.forEach(k => {
          if (fileData[k]) {
            const t = tractDefs[k];
            ['carPath','carPathReverse','bikePath','crossings','driveways','disabled','hotspots','blockage','scale'].concat(['sideStreets','stalls','moto']).forEach(f => {
              if(fileData[k][f] !== undefined) t[f] = fileData[k][f];
            });
          }
        });
      }
    } catch(e) { console.warn('Nessun viale_calibration.json trovato.'); }

    tractOrder.forEach(k => {
      try {
        const saved = localStorage.getItem('viale_tract_' + k);
        if (!saved) return;
        const data = JSON.parse(saved);
        const t = tractDefs[k];
        ['carPath','carPathReverse','bikePath','crossings','driveways','disabled','hotspots','blockage','scale'].concat(['sideStreets','stalls','moto']).forEach(f => {
          if(data[f] !== undefined) {
            // Se in locale l'array è vuoto o privo di geometria reale, ma nel file del server è popolato, mantieni quello del server
            let isLocalEmpty = false;
            if (Array.isArray(data[f])) {
              if (data[f].length === 0) {
                isLocalEmpty = true;
              } else {
                if (Array.isArray(data[f][0]) && typeof data[f][0][0] === 'number') {
                  if (data[f].length < 2) isLocalEmpty = true;
                } else {
                  const hasValidGeometry = data[f].some(item => {
                    if (!item) return false;
                    if (Array.isArray(item.path) && item.path.length >= 2) return true;
                    if (Array.isArray(item.area) && item.area.length >= 3) return true;
                    if (typeof item.x === 'number' && typeof item.y === 'number') return true;
                    return false;
                  });
                  if (!hasValidGeometry) isLocalEmpty = true;
                }
              }
            }
            const hasServerData = fileData && fileData[k] && Array.isArray(fileData[k][f]) && fileData[k][f].length > 0;
            if (isLocalEmpty && hasServerData) {
              // Non sovrascrivere
            } else {
              t[f] = data[f];
            }
          }
        });
      } catch(e) { console.warn('Calibrazione locale ' + k + ':', e); }
    });
  }
  await loadCalibrationData();

  function normalizeBikePaths(){
    tractOrder.forEach(k => {
      const t = tractDefs[k];
      if (!t.carPath || t.carPath.length === 0 || !t.bikePath || t.bikePath.length === 0) {
        t.bikePathFwd = t.bikePath || [];
        return;
      }
      const carDx = t.carPath[t.carPath.length-1][0] - t.carPath[0][0];
      const bikeDx = t.bikePath[t.bikePath.length-1][0] - t.bikePath[0][0];
      t.bikePathFwd = (Math.sign(carDx) === Math.sign(bikeDx)) ? t.bikePath : [...t.bikePath].reverse();
    });
  }
  normalizeBikePaths();

  tractOrder.forEach(k => {
    const o = document.createElement('option');
    o.value = k; o.textContent = tractDefs[k].title;
    ui.tractSelect.appendChild(o);
    const img = new Image(); img.src = tractDefs[k].image; imageCache[k] = img;
  });

  let tract = tractDefs.D;
  let paused = false;
  let lastTime = performance.now();
  let entities = {cars:[], bikes:[], peds:[], drivewayCars:[], sideCars:[], reverseCars:[], parked:[], van:null};
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, '__entities', { get: () => entities, configurable: true });
    Object.defineProperty(window, '__tract', { get: () => tract, configurable: true });
    window.__spawnReverse = () => { try { spawnReverseCar(); return entities.reverseCars.length; } catch(e) { return 'err: ' + e.message; } };
  }
  let flashes = [];
  let spawners = {car:0,bike:0,ped:0,driveway:0,side:0,special:0,parking:0,delivery:0};
  let parkingSlots = [];
  let crossingCarTs = []; 
  let logTimes = {};
  let stats = {crashes:0, nearMisses:0};
  let eventHistory = []; 
  let throughCount = 0;
  let excessCO2 = 0;
  
  let cam = { x: 0, y: 0, zoom: 1 };
  let isPanning = false;
  let lastPanPos = { x: 0, y: 0 };
  
  function updateCanvasSize() {
    const wrap = document.querySelector('.stageWrap');
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    stage.width = rect.width * dpr;
    stage.height = rect.height * dpr;
  }
  window.addEventListener('resize', updateCanvasSize);
  
  function resetCamera() {
    if(!tract) return;
    const wrap = document.querySelector('.stageWrap');
    const rect = wrap.getBoundingClientRect();
    cam.zoom = Math.min(rect.width / tract.width, rect.height / tract.height, 1);
    cam.x = (rect.width - tract.width * cam.zoom) / 2;
    cam.y = (rect.height - tract.height * cam.zoom) / 2;
  }

  function polyLengths(points){
    if(!points || points.length < 2) return {lens:[0], total:0};
    let lens=[0], total=0;
    for(let i=1;i<points.length;i++){
      const dx=points[i][0]-points[i-1][0], dy=points[i][1]-points[i-1][1];
      total += Math.hypot(dx,dy); lens.push(total);
    }
    return {lens,total};
  }
  function pointOnPath(points, t){
    if(!points || points.length === 0) return {x:0, y:0, angle:0};
    if(points.length === 1) return {x:points[0][0], y:points[0][1], angle:0};
    const {lens,total} = polyLengths(points);
    if(total === 0) return {x:points[0][0], y:points[0][1], angle:0};
    const target = (isNaN(t) ? 0 : t) * total;
    
    if(t < 0){
      const a = points[0], b = points[1];
      const ang = Math.atan2(b[1]-a[1], b[0]-a[0]);
      return { x: a[0] + target*Math.cos(ang), y: a[1] + target*Math.sin(ang), angle: ang };
    }
    if(t > 1){
      const n = points.length;
      const a = points[n-2], b = points[n-1];
      const ang = Math.atan2(b[1]-a[1], b[0]-a[0]);
      const over = target - total;
      return { x: b[0] + over*Math.cos(ang), y: b[1] + over*Math.sin(ang), angle: ang };
    }

    let i=1; while(i<lens.length && lens[i] < target) i++;
    if(i >= points.length) i = points.length - 1;
    const a = points[i-1], b = points[i], prev=lens[i-1], segLen=lens[i]-prev || 1;
    const local = Math.max(0, Math.min(1, (target-prev)/segLen));
    return {
      x: a[0] + (b[0]-a[0])*local,
      y: a[1] + (b[1]-a[1])*local,
      angle: Math.atan2(b[1]-a[1], b[0]-a[0])
    };
  }
  function pathTotalLength(points){ return polyLengths(points).total; }
  function rand(min,max){ return min + Math.random()*(max-min); }
  function dist(a,b){ return Math.hypot(a.x-b.x, a.y-b.y); }
  function lerp(a,b,t){ return a + (b-a)*t; }
  function lerpAngle(a,b,t){
    let d = b - a;
    while(d > Math.PI) d -= 2*Math.PI;
    while(d < -Math.PI) d += 2*Math.PI;
    return a + d*t;
  }
  function nearestT(path, pt){
    let bestT = 0, bestD = Infinity;
    const N = 200;
    for(let i=0;i<=N;i++){
      const t = i/N;
      const p = pointOnPath(path, t);
      const d = (p.x-pt.x)**2 + (p.y-pt.y)**2;
      if(d < bestD){ bestD = d; bestT = t; }
    }
    return {t: bestT, d: Math.sqrt(bestD)};
  }
  function nearestCarT(pt){ return nearestT(tract.carPath, pt); }
  function nearestBikeT(pt){ return nearestT(tract.bikePathFwd, pt); }
  function rectContainsPoint(r,p){ return p.x>=r.x && p.x<=r.x+r.w && p.y>=r.y && p.y<=r.y+r.h; }
  function isPointInPolygon(p, poly) {
    if(!poly || poly.length < 3) return false;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1];
      const xj = poly[j][0], yj = poly[j][1];
      const intersect = ((yi > p.y) !== (yj > p.y)) && (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function vDim(type){
    const def = VEHICLE_TYPES[type] || VEHICLE_TYPES.citycar;
    const s = (tract && tract.scale) ? tract.scale : 1.0;
    return { 
      length: def.length * s, 
      width: def.width * s, 
      name: def.name,
      body: def.body,
      accent: def.accent,
      glass: def.glass
    };
  }
  function getOpacity(t, min=-0.1, max=1.1) {
    if (t < 0) return Math.max(0, (t - min) / (0 - min));
    if (t > 1) return Math.max(0, (max - t) / (max - 1));
    return 1;
  }
  function cubicBezier(P0,P1,P2,P3,t){
    const u=1-t, u2=u*u, u3=u2*u, t2=t*t, t3=t2*t;
    return {
      x: u3*P0.x + 3*u2*t*P1.x + 3*u*t2*P2.x + t3*P3.x,
      y: u3*P0.y + 3*u2*t*P1.y + 3*u*t2*P2.y + t3*P3.y
    };
  }
  function cubicTangent(P0,P1,P2,P3,t){
    const u=1-t;
    return {
      x: 3*u*u*(P1.x-P0.x) + 6*u*t*(P2.x-P1.x) + 3*t*t*(P3.x-P2.x),
      y: 3*u*u*(P1.y-P0.y) + 6*u*t*(P2.y-P1.y) + 3*t*t*(P3.y-P2.y)
    };
  }
  function mPos(m){
    const p = m.phases[m.phaseIdx];
    return cubicBezier(p.P0, p.P1, p.P2, p.P3, m.phaseT);
  }
  function mHeading(m){
    const p = m.phases[m.phaseIdx];
    if(p.headingMode === 'fixed') return p.heading;
    const tan = cubicTangent(p.P0, p.P1, p.P2, p.P3, m.phaseT);
    let a = Math.atan2(tan.y, tan.x);
    if(p.reversed) a += Math.PI;
    return a;
  }
  function getMergingCarPos(e){
    const t = Math.min(1, Math.max(0, e.mergeAnimT || 0));
    const dist = Math.hypot(e.mergeEnd.x - e.mergeStart.x, e.mergeEnd.y - e.mergeStart.y) || 1;
    const L1 = dist * 0.45;
    const P1x = e.mergeStart.x + Math.cos(e.mergeAngle0) * L1;
    const P1y = e.mergeStart.y + Math.sin(e.mergeAngle0) * L1;
    const L2 = dist * 0.45;
    const P2x = e.mergeEnd.x - Math.cos(e.mergeAngle1) * L2;
    const P2y = e.mergeEnd.y - Math.sin(e.mergeAngle1) * L2;
    const mt = 1 - t;
    const x = mt*mt*mt * e.mergeStart.x + 3 * mt*mt*t * P1x + 3 * mt*t*t * P2x + t*t*t * e.mergeEnd.x;
    const y = mt*mt*mt * e.mergeStart.y + 3 * mt*mt*t * P1y + 3 * mt*t*t * P2y + t*t*t * e.mergeEnd.y;
    const dx = 3*mt*mt * (P1x - e.mergeStart.x) + 6*mt*t * (P2x - P1x) + 3*t*t * (e.mergeEnd.x - P2x);
    const dy = 3*mt*mt * (P1y - e.mergeStart.y) + 6*mt*t * (P2y - P1y) + 3*t*t * (e.mergeEnd.y - P2y);
    return { x, y, angle: Math.atan2(dy, dx) };
  }
  function mAdvance(m, dt){
    const phase = m.phases[m.phaseIdx];
    m.phaseT += dt / phase.duration;
    if(m.phaseT >= 1){
      if(m.phaseIdx + 1 < m.phases.length){
        m.phaseIdx++; m.phaseT = 0;
        return false;
      }
      m.phaseT = 1;
      return true;
    }
    return false;
  }
  function isMergePathClear(targetT, yieldTime, streetPath=null){
    const path = tract.carPath;
    const carPathLen = pathTotalLength(path);
    if(carPathLen <= 0) return true;
    const mergeDist = (isNaN(targetT) ? 0 : targetT) * carPathLen;
    const margin = Math.max(65, 95 - yieldTime * 20);
    
    return !entities.cars.some(c => {
      const busy = (c.state === 'driving' || c.state === 'illegal-stopped' || c.state === 'maneuver-in' || c.state === 'turning-out');
      if(!busy) return false;
      const distToMerge = mergeDist - c.dist;
      
      // Safety margin: don't merge if a car is too close ahead or has just passed
      const backMargin = -35; 
      const frontMargin = margin + 30;
      
      if(distToMerge > backMargin && distToMerge < frontMargin){
        // Handshake: if the car on viale is stopped specifically waiting for this street to clear, allow merge
        if(c.speed < 2 && c.stopReason === 'STREET_BUSY' && streetPath && c.targetSideStreet && c.targetSideStreet.path === streetPath) return false;
        return true;
      }
      return false;
    });
  }
  function bikesNear(x, y, radius=32){
    return entities.bikes.some(b => {
      const bp = pointOnPath(tract.bikePathFwd, b.t);
      return Math.hypot(bp.x-x, bp.y-y) < radius;
    });
  }

  function carBaseSpeed(){ return pathTotalLength(tract.carPath) / 14; }
  // --- Pendenze -----------------------------------------------------------
  // Parsing di tract.slopes (es. "8,4% · 8,5% · 8,9%") in array numerico.
  function parseSlopes(str){
    if(!str || typeof str !== 'string') return [];
    // Normalizzo prima la virgola decimale → punto, poi splitto solo sui separatori "·;|/" o doppio spazio.
    const norm = str.replace(/(\d),(\d)/g, '$1.$2');
    return norm.split(/[·;|\/]+|\s{2,}/)
      .map(s => s.replace(/%/g,'').trim())
      .filter(s => s.length)
      .map(Number)
      .filter(n => !isNaN(n) && isFinite(n));
  }
  function tractSlopes(){
    if(!tract._slopesArr){
      tract._slopesArr = parseSlopes(tract.slopes);
    }
    return tract._slopesArr;
  }
  // Restituisce la pendenza (% positiva) nel punto t∈[0,1] del carPath.
  function slopeAtT(t){
    const arr = tractSlopes();
    if(!arr.length) return 0;
    const tt = Math.max(0, Math.min(0.9999, t));
    return arr[Math.floor(tt * arr.length)] || 0;
  }
  // Se la direzione di marcia è quella del carPath in avanti, e tract è uphillForward,
  // allora dir=1 = salita; altrimenti discesa.
  function isGoingUphill(dirForward){
    // Default: il carPath è disegnato in discesa (sx → dx).
    // Cioè dirForward = true ⇒ DISCESA. Si può forzare uphillForward:true su un tratto
    // dove il senso del polyline coincide con la salita.
    const forwardIsUphill = tract.uphillForward === true; // default false
    return forwardIsUphill ? dirForward : !dirForward;
  }
  // Fattore di velocità per auto/moto/furgoni in funzione di pendenza e tipo.
  // 1.0 = nessun effetto. < 1 in salita per i veicoli più pesanti.
  function carSlopeFactor(t, type, dirForward = true){
    const slope = slopeAtT(t);
    if(slope < 3) return 1;
    if(!isGoingUphill(dirForward)) return 1; // discesa: nessuna penalità
    const heavy = (type === 'van' || type === 'truck') ? 1.6 : (type === 'suv' ? 1.15 : 1.0);
    return Math.max(0.7, 1 - (slope - 3) * 0.04 * heavy);
  }
  // Fattore per le bici: forte penalità in salita, leggera spinta in discesa.
  function bikeSlopeFactor(t, dirForward){
    const slope = slopeAtT(t);
    if(slope < 0.5) return 1;
    if(isGoingUphill(dirForward)){
      return Math.max(0.35, 1 - slope * 0.08);
    }
    return Math.min(1.6, 1 + slope * 0.05);
  }

  function bikeBaseSpeed(){
    let s = pathTotalLength(tract.bikePathFwd) / 18;
    if(ui.scenarioSelect.value === 'vulnerable_users'){
      if(tract.key === 'H') s *= 0.5;
      else if(tract.key === 'G') s *= 0.65;
      else if(tract.key === 'F') s *= 0.85;
    }
    return s;
  }
  function pedBaseSpeed(crossing){
    const path = crossing.path || [[crossing.x,crossing.y1],[crossing.x,crossing.y2]];
    return pathTotalLength(path) / 7;
  }

  function buildParkingSlots(){
    const slots = [];
    const TYPICAL_HALF = 16;
    const MIN_BAY_DEPTH = TYPICAL_HALF + 6; 
    const proc = (stalls, type) => {
      if(!stalls) return;
      stalls.forEach((s, si) => {
        const pts = s.path;
        if(!pts || pts.length === 0) return;
        const stallAngle = pts.length >= 2
          ? Math.atan2(pts[pts.length-1][1]-pts[0][1], pts[pts.length-1][0]-pts[0][0])
          : 0;
        if(pts.length === 4){
          // Dynamic Parking Zone: treat 4-point rectangle as a continuous area
          const d01 = Math.hypot(pts[0][0]-pts[1][0], pts[0][1]-pts[1][1]);
          const d12 = Math.hypot(pts[1][0]-pts[2][0], pts[1][1]-pts[2][1]);
          const isHorizontal = d01 > d12;
          const totalLen = isHorizontal ? d01 : d12;
          let angle, ax, ay;
          if(isHorizontal){
            angle = Math.atan2(pts[1][1]-pts[0][1], pts[1][0]-pts[0][0]);
            ax = (pts[0][0] + pts[3][0]) / 2;
            ay = (pts[0][1] + pts[3][1]) / 2;
          } else {
            angle = Math.atan2(pts[2][1]-pts[1][1], pts[2][0]-pts[1][0]);
            ax = (pts[0][0] + pts[1][0]) / 2;
            ay = (pts[0][1] + pts[1][1]) / 2;
          }
          
          slots.push({
            id: `${type}_${si}`, parentName: s.name,
            x: ax, y: ay, // Anchor ora centrato
            pts: pts, angle: angle,
            totalLen: totalLen,
            type: type, isZone: true
          });
          return;
        }
        pts.forEach((pt, j) => {
          const near = nearestCarT({x:pt[0], y:pt[1]});
          const carPos = pointOnPath(tract.carPath, near.t);
          const distToRoad = Math.hypot(pt[0] - carPos.x, pt[1] - carPos.y);
          let isBay = false;
          if(distToRoad >= MIN_BAY_DEPTH && pts.length >= 2){
            let diff = stallAngle - carPos.angle;
            while(diff > Math.PI) diff -= 2*Math.PI;
            while(diff < -Math.PI) diff += 2*Math.PI;
            const absDiff = Math.min(Math.abs(diff), Math.PI - Math.abs(diff));
            isBay = absDiff > Math.PI/4;
          }
          let spotAngle = isBay
            ? Math.atan2(pt[1] - carPos.y, pt[0] - carPos.x) 
            : carPos.angle;

          if (type === 'moto') {
            const angleToRoad = Math.atan2(pt[1] - carPos.y, pt[0] - carPos.x);
            // Tilt motorcycles ~60 degrees relative to the road (spina di pesce)
            spotAngle = lerpAngle(carPos.angle, angleToRoad, 0.65);
          }

          slots.push({
            id: `${type}_${si}_${j}`,
            parentName: s.name + (pts.length>1 ? ` · #${j+1}` : ''),
            x: pt[0], y: pt[1], angle: spotAngle,
            type, isBay, distToRoad,
            entryT: near.t,
            entryX: carPos.x, entryY: carPos.y, entryAngle: carPos.angle
          });
        });
      });
    };
    proc(tract.stalls, 'normal');
    proc(tract.disabled, 'disabled');
    proc(tract.moto, 'moto');
    return slots;
  }

  function buildCrossingCarTs(){
    return (tract.crossings || []).map(c => {
      const pts = c.path || c.area || (typeof c.x === 'number' && typeof c.y1 === 'number' && typeof c.y2 === 'number' ? [[c.x,c.y1],[c.x,c.y2]] : null);
      if(!pts || pts.length === 0){
        return null;
      }
      let mid;
      if(pts.length >= 3){
         let sx=0, sy=0; pts.forEach(p=>{sx+=p[0]; sy+=p[1]});
         mid = {x:sx/pts.length, y:sy/pts.length};
      } else {
         mid = {x:(pts[0][0]+pts[pts.length-1][0])/2, y:(pts[0][1]+pts[pts.length-1][1])/2};
      }
      const near = nearestCarT(mid);
      return {crossing: c, carT: near.t, dist: near.d};
    }).filter(item => item !== null && item.dist < 40); // Solo se il passaggio pedonale è effettivamente sul Viale
  }

  function resetScene(full=true){
    tract = tractDefs[ui.tractSelect.value];
    tract._slopesArr = null; // invalidate slope cache on tract switch
    updateCanvasSize();
    resetCamera();
    
    (tract.crossings || []).forEach(c => {
      const pts = c.path || c.area || (typeof c.x === 'number' && typeof c.y1 === 'number' && typeof c.y2 === 'number' ? [[c.x,c.y1],[c.x,c.y2]] : null);
      if(!pts || pts.length === 0){
        c.walkPath = null;
        c.intersectsBikePath = false;
        return;
      }
      // Automatic walking path from 4-point rectangle
      if(pts.length === 4){
        // Find midpoints of opposite sides. Assume walking between the "short" ends.
        const d01 = Math.hypot(pts[0][0]-pts[1][0], pts[0][1]-pts[1][1]);
        const d12 = Math.hypot(pts[1][0]-pts[2][0], pts[1][1]-pts[2][1]);
        if(d01 < d12){
           // Sides 0-1 and 2-3 are the "ends"
           c.walkPath = [
             [(pts[0][0]+pts[1][0])/2, (pts[0][1]+pts[1][1])/2],
             [(pts[2][0]+pts[3][0])/2, (pts[2][1]+pts[3][1])/2]
           ];
        } else {
           // Sides 1-2 and 3-0 are the "ends"
           c.walkPath = [
             [(pts[1][0]+pts[2][0])/2, (pts[1][1]+pts[2][1])/2],
             [(pts[3][0]+pts[0][0])/2, (pts[3][1]+pts[0][1])/2]
           ];
        }
      } else {
        c.walkPath = pts;
      }

      let minD = Infinity;
      for(let t=0; t<=1; t+=0.1){
         const pt = pointOnPath(c.walkPath, t);
         const near = nearestBikeT(pt);
         if(near.d < minD) minD = near.d;
      }
      c.intersectsBikePath = minD < 15;
    });
    entities = {cars:[], bikes:[], peds:[], drivewayCars:[], sideCars:[], reverseCars:[], parked:[], van:null, ambulance:null};
    flashes = []; spawners = {car:0,bike:0,ped:0,driveway:0,side:0,special:0,parking:0,delivery:0};
    if(full){
      stats = {crashes:0, nearMisses:0};
      eventHistory = []; throughCount = 0;
      excessCO2 = 0;
      ui.logBox.innerHTML='';
    }
    parkingSlots = buildParkingSlots();
    crossingCarTs = buildCrossingCarTs();
    tract.turnInStreets = (tract.sideStreets || []).filter(s => s.direction === 'in' || s.direction === 'both').map(s => {
       const len = pathTotalLength(s.path);
       let minD = Infinity;
       let intersectT = 1;
       for(let tt=0.5; tt<=1; tt+=0.02){
          const pt = pointOnPath(s.path, tt);
          const near = nearestCarT(pt);
          if(near.d < minD){ minD = near.d; intersectT = tt; }
       }
       const intersectPt = pointOnPath(s.path, intersectT);
       const mainNear = nearestCarT(intersectPt);
       return { ...s, intersectT: mainNear.t, pathStartT: intersectT };
    });
    
    parkingSlots.forEach(slot => {
      const fillRate = Number(ui.parkingFill.value) / 100;
      
      if(slot.isZone){
        let used = 2; // Initial margin
        while(used < slot.totalLen - 6){
          if(Math.random() > fillRate) { used += 4.5; continue; } // Random empty gaps
          
          let vType = 'citycar';
          if(slot.type === 'moto') vType = 'motorbike';
          else if(slot.type === 'disabled') vType = 'citycar';
          else {
            const r = Math.random();
            if(r < 0.15) vType = 'motorbike';
            else if(r < 0.60) vType = 'citycar';
            else if(r < 0.85) vType = 'suv';
            else vType = 'van';
          }
          
          const vDef = vDim(vType);
          const vLen = vDef.length;
          if(used + vLen + 1 > slot.totalLen) break;
          
          const offset = used + vLen/2;
          const vx = slot.x + Math.cos(slot.angle) * offset;
          const vy = slot.y + Math.sin(slot.angle) * offset;
          const near = nearestCarT({x: vx, y: vy});
          
          const customColors = getRandomVehicleColors(vType);
          entities.parked.push({
            id: slot.id + '_' + entities.parked.length,
            x: vx, y: vy, angle: slot.angle,
            vehicleType: vType,
            state: 'parked', life: 1,
            parentName: slot.parentName,
            entryT: near.t,
            entryAngle: slot.angle, // Parallel to zone
            isBay: false, // Zones are typically parallel
            customColors
          });
          
          used += vLen + rand(2, 6) * (tract.scale || 1.0); // Gap scaled with vehicle size
        }
      } else {
        if(Math.random() < fillRate){
          const type = slot.type==='disabled' ? 'citycar' : (slot.type==='moto' ? 'motorbike' : pickVehicleType());
          const customColors = getRandomVehicleColors(type);
          entities.parked.push({
            id: slot.id,
            x: slot.x, y: slot.y, angle: slot.angle,
            vehicleType: type,
            state: 'parked', life: 1,
            parentName: slot.parentName,
            entryT: slot.entryT,
            entryAngle: slot.entryAngle,
            isBay: slot.isBay,
            customColors
          });
        }
      }
    });
    renderTexts(); updateStats();
  }

  function renderTexts(){
    tract = tractDefs[ui.tractSelect.value];
    ui.tractTitle.textContent = tract.title;
    ui.tractDescription.textContent = tract.description;
    ui.slopeChip.textContent = tract.slopes;
    ui.orientationChip.textContent = tract.orientation;
    ui.scenarioChip.textContent = ui.scenarioSelect.options[ui.scenarioSelect.selectedIndex].text;
    ui.bugList.innerHTML = tract.bugs.map(x => `<li>${x}</li>`).join('');
    if (ui.badgeActiveTract) {
      ui.badgeActiveTract.innerHTML = `🗺️ SEZIONE: TAVOLA ${ui.tractSelect.value}`;
    }
  }

  function pushLog(type, text, icon='info'){
    const div = document.createElement('div');
    div.className = `logItem log-${type}`;
    const icons = {crash:'💥', yield:'🤝', debug:'🛠️', info:'ℹ️', jam:'🛑', block:'🚚'};
    const ic = icons[icon] || icons.info;
    div.innerHTML = `<span class="logIcon">${ic}</span> <span class="logTime">${new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'})}</span> ${text}`;
    ui.logBox.prepend(div);
    if(ui.logBox.children.length > 40) ui.logBox.lastChild.remove();
  }
  
  function devLog(id, text, x){
    if(!ui.debugMode || !ui.debugMode.checked) return;
    const now = performance.now();
    if(logTimes[id] && (now - logTimes[id] < 3000)) return; // Throttling
    logTimes[id] = now;
    pushLog('debug', `[DEV] Pos:${Math.round(x)}px - ${text}`, 'debug');
  }

  function addFlash(x,y,r,label,color='rgba(220,38,38,.55)'){ flashes.push({x,y,r,life:1,label,color}); }
  function trackEvent(type){ eventHistory.push({t: performance.now(), type}); }
  function eventsLastMinute(type){
    const cutoff = performance.now() - 60000;
    let n = 0;
    for(const e of eventHistory){ if(e.t > cutoff && e.type === type) n++; }
    return n;
  }
  function updateStats(){
    ui.statCrashes.textContent = stats.crashes;
    ui.statBrakes.textContent = eventsLastMinute('brake');
    ui.statNearMisses.textContent = stats.nearMisses;
    if (ui.badgeNearMisses) {
      ui.badgeNearMisses.innerHTML = `🛡️ ${stats.nearMisses} COLLISIONI EVITATE`;
    }
    const occ = entities.parked.filter(p => p.state === 'parked' || p.state === 'parking').length;
    ui.statParked.textContent = occ;
    ui.statParkedSub.textContent = `${occ} / ${parkingSlots.length}`;
    ui.statThrough.textContent = eventsLastMinute('through');
    const inTransit = entities.cars.filter(c => c.state === 'driving' || c.state === 'illegal-stopped' || c.state === 'maneuver-in').length;
    ui.statThroughSub.textContent = `/ min · in transito ${inTransit}`;
    const dCount = parkingSlots.filter(s => s.type==='disabled').length;
    const mCount = parkingSlots.filter(s => s.type==='moto').length;
    ui.stallsChip.textContent = `${parkingSlots.length} (${dCount} dis., ${mCount} moto)`;

    // Update Floating HUD elements
    if (ui.hudCO2) {
      if (excessCO2 < 1000) {
        ui.hudCO2.textContent = `${excessCO2.toFixed(1)} g`;
      } else {
        ui.hudCO2.textContent = `${(excessCO2 / 1000).toFixed(3)} kg`;
      }
    }
    if (ui.hudActive) {
      const activeCount = entities.cars.filter(c => c.state === 'driving' && c.t > 0 && c.t < 1).length +
                          entities.bikes.filter(b => b.t > 0 && b.t < 1).length +
                          entities.sideCars.filter(sc => sc.state !== 'done').length +
                          entities.drivewayCars.filter(dc => dc.state !== 'done').length;
      ui.hudActive.textContent = `${activeCount} veic.`;
    }
    if (ui.hudSpeed) {
      const activeCars = entities.cars.filter(c => c.state === 'driving' && c.t > 0 && c.t < 1);
      let avgSpeedKmh = 0;
      if (activeCars.length > 0) {
        let totalSpeed = 0;
        activeCars.forEach(c => {
          totalSpeed += (c.speed / carBaseSpeed()) * 40;
        });
        avgSpeedKmh = totalSpeed / activeCars.length;
      } else {
        avgSpeedKmh = 40; // Default when empty
      }
      ui.hudSpeed.textContent = `${avgSpeedKmh.toFixed(1)} km/h`;
    }
  }

  function makeCar(opts={}){
    const type = opts.type || pickVehicleType();
    const def = vDim(type);
    const s = (tract && tract.scale) ? tract.scale : 1.0;
    const speedVar = rand(0.8, 1.2);
    const startT = (opts.startT !== undefined) ? opts.startT : -0.08;
    const pathLen = pathTotalLength(tract.carPath);
    const maxSpeed = carBaseSpeed() * (VEHICLE_TYPES[type].speedFactor) * speedVar * s;
    const customColors = opts.customColors || getRandomVehicleColors(type);
    return {
      id: Math.random().toString(36).substr(2, 5),
      type,
      t: startT,
      dist: startT * pathLen,
      speed: opts.speed !== undefined ? opts.speed : maxSpeed * 0.85,
      maxSpeed,
      accel: VEHICLE_TYPES[type].accel * s, decel: VEHICLE_TYPES[type].decel * s,
      length: def.length, width: def.width,
      state: 'driving',
      _emergencyHold: 0,
      customColors
    };
  }
  function spawnCar(opts){
    const entryT = (opts && opts.startT !== undefined) ? opts.startT : -0.08;
    const carPathLen = pathTotalLength(tract.carPath);
    const entryDist = entryT * carPathLen;
    const tooClose = entities.cars.some(c => (c.state === 'driving' || c.state === 'illegal-stopped') && c.dist < entryDist + 160 && c.dist > entryDist - 5);
    if(tooClose) return false;
    const c = makeCar(opts || {});
    
    if(tract.turnInStreets && tract.turnInStreets.length > 0 && Math.random() < 0.35 && !c.targetSlot && c.type !== 'van' && c.type !== 'truck'){
       const valid = tract.turnInStreets.filter(s => s.intersectT > c.t + 0.1);
       if(valid.length > 0){
          c.targetSideStreet = valid[Math.floor(rand(0, valid.length))];
       }
    }
    
    entities.cars.push(c);
    return true;
  }
  function spawnBike(){
    const s = (tract && tract.scale) ? tract.scale : 1.0;
    const dir = Math.random() < .5 ? 1 : -1;
    const startT = dir === 1 ? -0.08 : 1.08;
    const startPt = pointOnPath(tract.bikePathFwd, dir === 1 ? 0 : 1);
    
    const pedBusy = entities.peds.some(p => {
       const pp = pointOnPath(p.path, p.t);
       return Math.hypot(pp.x - startPt.x, pp.y - startPt.y) < 25 * s;
    });
    if(pedBusy) return false;
    
    const bikeBusy = entities.bikes.some(b => {
       const bp = getBikePos(b);
       return Math.hypot(bp.x - startPt.x, bp.y - startPt.y) < 35 * s;
    });
    if(bikeBusy) return false;

    const colors = getRandomBikeColors();
    entities.bikes.push({
      dir, t: startT, dist: startT === -0.08 ? -0.08 * pathTotalLength(tract.bikePathFwd) : 1.08 * pathTotalLength(tract.bikePathFwd),
      baseSpeed: bikeBaseSpeed() * rand(0.75, 1.25) * s,
      _emergencyHold: 0,
      customColors: colors
    });
    return true;
  }
  function spawnPed(){
    if(!tract.crossings.length) return;
    const eligible = tract.crossings.filter(c => c.walkPath && c.walkPath.length >= 2);
    if(!eligible.length) return;
    const s = (tract && tract.scale) ? tract.scale : 1.0;
    const crossing = eligible[Math.floor(rand(0,eligible.length))];
    const path = crossing.walkPath;
    const dir = Math.random() < .5 ? 1 : -1;
    const ordered = dir === 1 ? path : [...path].reverse();
    
    const randType = Math.random();
    let wheelchair = false;
    let elderly = false;
    let child = false;
    let speedMult = 1.0;
    
    if(randType < 0.06){
      wheelchair = true;
      speedMult = 0.7;
    } else if(randType < 0.24){
      elderly = true;
      speedMult = 0.65;
    } else if(randType < 0.38){
      child = true;
      speedMult = 1.15;
    }
    
    const colors = getRandomPedColors(elderly, wheelchair, child);
    entities.peds.push({
      path: ordered, crossing, t: 0, dist:0,
      baseSpeed: rand(14, 26) * s * speedMult,
      wheelchair,
      elderly,
      child,
      customColors: colors
    });
  }
  function spawnDrivewayCar(){
    if(!tract.driveways || !tract.driveways.length) return;
    const d = tract.driveways[Math.floor(rand(0,tract.driveways.length))];
    const len = pathTotalLength(d.path);
    const type = Math.random() < 0.8 ? 'citycar' : 'suv';
    const busy = entities.drivewayCars.some(o => o.path === d.path && o.dist < 50);
    if(busy) return;
    const s = (tract && tract.scale) ? tract.scale : 1.0;
    const customColors = getRandomVehicleColors(type);
    entities.drivewayCars.push({
      type, ...vDim(type),
      path:d.path, t:-0.08, dist:-0.08 * len, baseSpeed: (len/7) * s, name:d.name,
      state:'travelling', _emergencyHold: 0,
      customColors
    });
  }
  function spawnSideStreetCar(){
    if(!tract.sideStreets || !tract.sideStreets.length) return;
    const revEntry = (tract.reverseConfig && tract.reverseConfig.entry) || null;
    const eligible = tract.sideStreets.filter(s => s.direction !== 'in' && s.name !== revEntry);
    if(!eligible.length) return;
    const s = eligible[Math.floor(rand(0,eligible.length))];
    const len = pathTotalLength(s.path);
    const type = pickVehicleType();
    const busy = entities.sideCars.some(o => o.path === s.path && o.dist < 50);
    if(busy) return;
    const sc = (tract && tract.scale) ? tract.scale : 1.0;
    const customColors = getRandomVehicleColors(type);
    entities.sideCars.push({
      type, ...vDim(type),
      path:s.path, t:-0.08, dist:-0.08 * len, baseSpeed: (len/3.5) * sc, name:s.name,
      state:'travelling', _emergencyHold: 0,
      customColors
    });
  }
  function spawnReverseCar(){
    if(!tract.carPathReverse || tract.carPathReverse.length < 2) return;
    if(!tract.reverseConfig) return;
    const cfg = tract.reverseConfig;
    if(!cfg.entry) return;
    const entryStreet = tract.sideStreets.find(s => s.name === cfg.entry);
    if(!entryStreet || !entryStreet.path || entryStreet.path.length < 2) return;

    const revPath = tract.carPathReverse;
    const revLen = pathTotalLength(revPath);
    if(revLen <= 0) return;

    const exits = (cfg.exits || []).map(n => tract.sideStreets.find(s => s.name === n))
      .filter(s => s && s.path && s.path.length >= 2);
    if(!exits.length) return;

    // Avoid stacking too many at entry.
    const busy = entities.reverseCars.some(o => o.state === 'entering' || (o.state === 'reverse' && o.dist < 80));
    if(busy) return;

    // Build entry path: from outside endpoint of entry street to its sbocco on viale,
    // continuing onto carPathReverse start.
    const entryDHead = Math.hypot(entryStreet.path[0][0]-revPath[0][0], entryStreet.path[0][1]-revPath[0][1]);
    const entryDTail = Math.hypot(entryStreet.path[entryStreet.path.length-1][0]-revPath[0][0], entryStreet.path[entryStreet.path.length-1][1]-revPath[0][1]);
    const entryPath = entryDTail <= entryDHead ? entryStreet.path.slice() : entryStreet.path.slice().reverse();
    // Snap last point to revPath start for smooth join.
    entryPath[entryPath.length-1] = [revPath[0][0], revPath[0][1]];
    const entryLen = pathTotalLength(entryPath);

    // Pick a random exit street.
    const exitStreet = exits[Math.floor(rand(0, exits.length))];
    const dHead = nearestT(revPath, {x: exitStreet.path[0][0], y: exitStreet.path[0][1]}).d;
    const dTail = nearestT(revPath, {x: exitStreet.path[exitStreet.path.length-1][0], y: exitStreet.path[exitStreet.path.length-1][1]}).d;
    if(Math.min(dHead, dTail) > 80) return;
    const sboccoFirst = dHead <= dTail;
    const sboccoPt = sboccoFirst ? exitStreet.path[0] : exitStreet.path[exitStreet.path.length-1];
    const intersect = nearestT(revPath, {x: sboccoPt[0], y: sboccoPt[1]});
    const exitPath = sboccoFirst ? exitStreet.path.slice() : exitStreet.path.slice().reverse();
    exitPath[0] = [sboccoPt[0], sboccoPt[1]];
    const exitLen = pathTotalLength(exitPath);

    const type = pickVehicleType();
    const sc = (tract && tract.scale) ? tract.scale : 1.0;
    const customColors = getRandomVehicleColors(type);
    const speedFactor = (VEHICLE_TYPES[type] && VEHICLE_TYPES[type].speedFactor) || 1.0;
    const baseSpeed = carBaseSpeed() * speedFactor * 0.85; // poco più lente del flusso principale (zona delicata)

    entities.reverseCars.push({
      type, ...vDim(type),
      state: 'entering',
      entryPath, revPath, exitPath,
      entryLen, revLen, exitLen,
      exitT_on_rev: intersect.t,
      entryDist: 0, dist: 0, exitDist: 0,
      baseSpeed,
      customColors,
      exitName: exitStreet.name,
      entryName: entryStreet.name
    });
  }
  function spawnDisabledUser(){
    if(!tract.disabled || !tract.disabled.length) return;
    const d = tract.disabled[Math.floor(rand(0, tract.disabled.length))];
    const len = pathTotalLength(d.path);
    const colors = getRandomPedColors(false, true, false);
    entities.peds.push({
      path:d.path, t:0, dist:0, baseSpeed: (len/9) * (tract.scale || 1.0),
      wheelchair:true, elderly:false, child:false, customColors: colors
    });
  }
  function spawnDeliveryVan(){
    if(entities.cars.some(c => c.type==='van' && c.targetSlot)) return;
    const free = parkingSlots.filter(s => !entities.parked.some(p => p.id===s.id));
    if(!free.length) return;
    const slot = free[Math.floor(rand(0, free.length))];
    spawnCar({type:'van', targetSlot: slot});
    pushLog('delivery', `Furgone in arrivo per consegna (stallo ${slot.parentName}).`);
  }
  function spawnBlockingVan(){
    if(entities.van) return false;
    if(!tract.blockage) return false;
    const blockNearT = nearestCarT({x:tract.blockage.x, y:tract.blockage.y}).t;
    const tooClose = entities.cars.some(c => (c.state === 'driving' || c.state === 'illegal-stopped') && c.dist < 110 && c.dist > -5);
    if(tooClose) return false;
    const v = makeCar({type:'van'});
    v.illegalStop = {atT: blockNearT};
    entities.cars.push(v);
    entities.van = {ref:v, parked:false, life:0};
    pushLog('block', 'Furgone in arrivo per sosta selvaggia.', 'crash');
    return true;
  }
  function spawnRoadworks(){
    if(entities.cars.some(c => c.isRoadworks)) return false;
    if(!tract.blockage || tract.blockage.x === 0) return false;
    const blockNearT = nearestCarT({x:tract.blockage.x, y:tract.blockage.y}).t;
    const tooClose = entities.cars.some(c => (c.state === 'driving' || c.state === 'illegal-stopped') && c.dist < 110 && c.dist > -5);
    if(tooClose) return false;
    const carPathLen = pathTotalLength(tract.carPath);
    const w = {
      id: 'roadworks_' + Math.random(),
      type: 'truck',
      state: 'illegal-stopped',
      t: blockNearT,
      dist: blockNearT * carPathLen,
      speed: 0,
      length: 24,
      width: 14,
      decel: 4,
      accel: 1,
      braking: false,
      _crashed: false,
      isRoadworks: true,
      roadworksLife: rand(15, 25)
    };
    entities.cars.push(w);
    pushLog('roadworks', '⚠️ Attenzione: Cantiere stradale mobile (lavori in corso) sulla carreggiata.', 'crash');
    addFlash(tract.blockage.x, tract.blockage.y, 32, 'CANTIERE STRADALE', 'rgba(234,179,8,.85)');
    return true;
  }
  function spawnDropOff(){
    if(entities.cars.some(c => c.isDropOff)) return false;
    const tooClose = entities.cars.some(c => (c.state === 'driving' || c.state === 'illegal-stopped') && c.dist < 60 && c.dist > -120);
    if(tooClose) return false;
    
    const w = makeCar({type: 'citycar', startT: -0.08});
    w.id = 'dropoff_' + Math.random();
    w.isDropOff = true;
    w.targetDropOffT = rand(0.30, 0.70);
    w.dropOffLife = 14;
    w.passengerSpawned = false;
    
    entities.cars.push(w);
    pushLog('dropoff', '🚗 Auto di cortesia entra in carreggiata per effettuare una sosta temporanea.', 'info');
    return true;
  }
  function spawnAmbulance(){
    if(entities.ambulance) return false;
    const tooClose = entities.cars.some(c => (c.state === 'driving' || c.state === 'illegal-stopped') && c.dist < 60 && c.dist > -120);
    if(tooClose) return false;
    const s = (tract && tract.scale) ? tract.scale : 1.0;
    const a = makeCar({type: 'ambulance', speed: carBaseSpeed() * 1.45 * s, startT: -0.08});
    a.id = 'ambulance_' + Math.random();
    a.isAmbulance = true;
    entities.cars.push(a);
    entities.ambulance = {ref: a};
    pushLog('emergency', '🚑 Emergenza: Sirene spiegate! Ambulanza in arrivo ad alta velocità. I veicoli accelerano.', 'crash');
    addFlash(30, tract.carPath[0][1], 50, 'AMBULANZA', 'rgba(37,99,235,.85)');
    return true;
  }

  function manageSpawns(dt){
    const scenario = ui.scenarioSelect.value;
    spawners.car -= dt; spawners.bike -= dt; spawners.ped -= dt;
    spawners.driveway -= dt; spawners.side -= dt; spawners.special -= dt;
    spawners.parking -= dt; spawners.delivery -= dt;
    if(spawners.reverse === undefined) spawners.reverse = 0;
    spawners.reverse -= dt;

    const carRate = Number(ui.carFlow.value);
    if(spawners.car <= 0 && carRate > 0){
      const ok = spawnCar();
      spawners.car = ok ? (60 / carRate) : 0.15;
    }
    const bikeRate = Number(ui.bikeFlow.value);
    if(spawners.bike <= 0 && bikeRate > 0){ 
      if(spawnBike()) spawners.bike = 60 / bikeRate;
      else spawners.bike = 0.2;
    }
    const pedRate = Number(ui.pedFlow.value);
    if(spawners.ped <= 0 && pedRate > 0 && tract.crossings.length){ spawnPed(); spawners.ped = 60 / pedRate; }

    if((scenario==='driveway_conflict' || scenario==='school_peak') && spawners.driveway <= 0){
       spawnDrivewayCar();
       spawners.driveway = scenario==='driveway_conflict' ? rand(15, 30) : rand(50, 100);
    }
    if(spawners.side <= 0 && tract.sideStreets && tract.sideStreets.length > 0){
       spawnSideStreetCar();
       const carRate = Number(ui.carFlow.value);
       if(carRate > 0){
         const baseInterval = (scenario==='school_peak' || scenario==='driveway_conflict') ? rand(6, 12) : rand(12, 28);
         spawners.side = baseInterval * (30 / Math.max(10, carRate));
       } else {
         spawners.side = 9999;
       }
    }
    if(spawners.reverse <= 0 && tract.carPathReverse && tract.carPathReverse.length >= 2 && tract.reverseConfig){
       spawnReverseCar();
       const carRate = Number(ui.carFlow.value);
       if(carRate > 0){
         spawners.reverse = rand(10, 22) * (30 / Math.max(10, carRate));
       } else {
         spawners.reverse = 9999;
       }
    }
    if(scenario==='vulnerable_users' && spawners.special <= 0 && tract.disabled.length){
       spawnDisabledUser(); spawners.special = rand(15, 30);
    }
    if(scenario==='delivery_block' && spawners.delivery <= 0){
       spawnDeliveryVan(); spawners.delivery = rand(20, 40);
    }
    if(scenario==='delivery_block' && spawners.special <= 0){
       if(spawnBlockingVan()) spawners.special = rand(25, 50);
       else spawners.special = 1;
    }
    if(scenario==='roadworks' && spawners.special <= 0){
       if(spawnRoadworks()) spawners.special = rand(25, 45);
       else spawners.special = 1;
    }
    if(scenario==='dropoff' && spawners.special <= 0){
       if(spawnDropOff()) spawners.special = rand(25, 45);
       else spawners.special = 1;
    }
    if(scenario==='ambulance' && spawners.special <= 0){
       if(spawnAmbulance()) spawners.special = rand(30, 50);
       else spawners.special = 1;
    }

    if(spawners.parking <= 0){
      const rate = Number(ui.parkingFlow.value);
      if(rate > 0){
        const interval = 3600 / Math.max(1, rate);
        const occupied = entities.parked.filter(p => p.state === 'parked');
        if(occupied.length > 0 && Math.random() < 0.5){
          const p = occupied[Math.floor(rand(0, occupied.length))];
          p.state = 'unparking'; p.animT = 0;
          pushLog('parking-out', `Veicolo esce dalla sosta (${p.parentName || 'Zona'}).`);
        }
        const reservedIds = new Set(entities.parked.map(p => p.id));
        const r = Math.random();
        let driverKind;
        if(r < 0.08) driverKind = 'disabled';
        else if(r < 0.11) driverKind = 'abuser';
        else driverKind = 'normal';
        const slotMatches = (s) => {
          if(driverKind === 'disabled' || driverKind === 'abuser') return s.type === 'disabled';
          return s.type === 'normal';
        };
        let free = parkingSlots.filter(s => {
          if(reservedIds.has(s.id)) return false;
          if(!slotMatches(s)) return false;
          for(const p of entities.parked){
            const minSpace = (vDim(p.vehicleType).length)/2 + 20;
            if(Math.hypot(p.x - s.x, p.y - s.y) < minSpace) return false;
          }
          return true;
        });
        if(free.length){
          for(const c of entities.cars){
            if(c.state !== 'driving' || c.targetSlot || c.illegalStop) continue;
            let bestSlot = null, bestLookahead = Infinity;
            for(const slot of free){
              const lookahead = slot.entryT - c.t;
              if(lookahead > 0.02 && lookahead < 0.30 && lookahead < bestLookahead){
                bestSlot = slot; bestLookahead = lookahead;
              }
            }
            if(bestSlot){
              c.targetSlot = bestSlot;
              c.driverKind = driverKind;
              entities.parked.push({
                id: bestSlot.id, slot: bestSlot, name: bestSlot.parentName, type: bestSlot.type,
                state: 'reserved', vehicleType: c.type, driverKind, animT: 0, customColors: c.customColors
              });
              if(driverKind === 'abuser'){
                pushLog('park-abuse', `Abuso stallo disabili: ${vDim(c.type).name} parcheggia in ${bestSlot.parentName} senza contrassegno.`, 'crash');
                addFlash(bestSlot.x, bestSlot.y, 28, 'ABUSO STALLO', 'rgba(220,38,38,.55)');
              } else if(driverKind === 'disabled'){
                pushLog('park-disabled', `Conducente con contrassegno usa lo stallo ${bestSlot.parentName}.`);
              } else {
                pushLog('parking-in', `${vDim(c.type).name} punta lo stallo ${bestSlot.parentName}.`);
              }
              break;
            }
          }
        }
        spawners.parking = interval;
      } else {
        spawners.parking = 5;
      }
    }
  }

  function startManeuver(c, slot){
    const carPos = pointOnPath(tract.carPath, c.t);
    const big = c.type==='truck' || c.type==='van';
    const carPathLen = pathTotalLength(tract.carPath);
    let phases;
    if(slot.isBay){
      const L1 = big ? 36 : 28;
      const L2 = big ? 30 : 24;
      phases = [{
        P0: {x: carPos.x, y: carPos.y},
        P1: {x: carPos.x + L1*Math.cos(carPos.angle), y: carPos.y + L1*Math.sin(carPos.angle)},
        P2: {x: slot.x - L2*Math.cos(slot.angle), y: slot.y - L2*Math.sin(slot.angle)},
        P3: {x: slot.x, y: slot.y},
        duration: big ? 3.4 : 2.6,
        headingMode: 'tangent'
      }];
    } else {
      const fwdRoad = {x: Math.cos(slot.entryAngle), y: Math.sin(slot.entryAngle)};
      const Lr = big ? 22 : 18;
      phases = [{
        P0: {x: carPos.x, y: carPos.y},
        P1: {x: carPos.x - Lr*fwdRoad.x, y: carPos.y - Lr*fwdRoad.y},
        P2: {x: slot.x + Lr*Math.cos(slot.angle), y: slot.y + Lr*Math.sin(slot.angle)},
        P3: {x: slot.x, y: slot.y},
        duration: big ? 3.0 : 2.4,
        headingMode: 'tangent',
        reversed: true
      }];
    }
    c.state = 'maneuver-in';
    c.maneuver = { phases, phaseIdx: 0, phaseT: 0 };
    const reservation = entities.parked.find(p => p.id === slot.id);
    if(reservation){
      reservation.state = 'parking';
      reservation.animT = 0;
      reservation.maneuver = c.maneuver;
      reservation.vehicleType = c.type;
    }
  }

  function startUnpark(p){
    const big = p.vehicleType==='truck' || p.vehicleType==='van';
    const carPathLen = pathTotalLength(tract.carPath);
    const isBay = p.isBay || (p.slot && p.slot.isBay);
    const entryT = p.entryT || (p.slot && p.slot.entryT);
    const entryAngle = p.entryAngle || (p.slot && p.slot.entryAngle);
    
    let phases;
    if(isBay){
      const L1 = big ? 30 : 24;
      const L2 = big ? 36 : 28;
      const backT = Math.max(0, entryT - 20 / carPathLen);
      const back = pointOnPath(tract.carPath, backT);
      const fwdRoad = {x: Math.cos(entryAngle), y: Math.sin(entryAngle)};
      phases = [{
        P0: {x: p.x, y: p.y},
        P1: {x: p.x - L1*Math.cos(p.angle), y: p.y - L1*Math.sin(p.angle)},
        P2: {x: back.x + L2*fwdRoad.x, y: back.y + L2*fwdRoad.y},
        P3: {x: back.x, y: back.y},
        duration: big ? 3.2 : 2.5,
        headingMode: 'tangent',
        reversed: true
      }];
    } else {
      const extraT = (big ? 40 : 30) / carPathLen;
      const exitT = Math.min(1, entryT + extraT);
      const exit = pointOnPath(tract.carPath, exitT);
      const fwdRoad = {x: Math.cos(entryAngle), y: Math.sin(entryAngle)};
      const Lf = 18;
      phases = [{
        P0: {x: p.x, y: p.y},
        P1: {x: p.x + Lf*Math.cos(p.angle), y: p.y + Lf*Math.sin(p.angle)},
        P2: {x: exit.x - Lf*fwdRoad.x, y: exit.y - Lf*fwdRoad.y},
        P3: {x: exit.x, y: exit.y},
        duration: big ? 2.5 : 1.8,
        headingMode: 'tangent'
      }];
    }
    p.state = 'unparking';
    p.animT = 0;
    p.maneuver = { phases, phaseIdx: 0, phaseT: 0 };
  }

  function startTurnIn(c, street){
    const carPos = pointOnPath(tract.carPath, c.t);
    const big = c.type==='truck' || c.type==='van';

    const inT = Math.max(0, street.pathStartT - 0.2);
    const inPt = pointOnPath(street.path, inT);
    const intersectPt = pointOnPath(street.path, street.pathStartT);

    const L1 = 12;
    const L2 = 12;

    const inDx = inPt.x - intersectPt.x;
    const inDy = inPt.y - intersectPt.y;
    const inLen = Math.hypot(inDx, inDy) || 1;
    const inFwd = {x: inDx/inLen, y: inDy/inLen};

    const turnEnd = {x: intersectPt.x + 30*inFwd.x, y: intersectPt.y + 30*inFwd.y};
    const drivePathLen = pathTotalLength(street.path);
    const exitDist = Math.min(drivePathLen, 220);
    const exitPt = {x: intersectPt.x + exitDist*inFwd.x, y: intersectPt.y + exitDist*inFwd.y};
    const turnEndAngle = Math.atan2(inFwd.y, inFwd.x);

    const phases = [
      {
        P0: {x: carPos.x, y: carPos.y},
        P1: {x: carPos.x + L1*Math.cos(carPos.angle), y: carPos.y + L1*Math.sin(carPos.angle)},
        P2: {x: intersectPt.x - L2*inFwd.x, y: intersectPt.y - L2*inFwd.y},
        P3: turnEnd,
        duration: big ? 2.5 : 1.8,
        headingMode: 'tangent'
      },
      {
        P0: turnEnd,
        P1: {x: turnEnd.x + (exitPt.x - turnEnd.x)*0.33, y: turnEnd.y + (exitPt.y - turnEnd.y)*0.33},
        P2: {x: turnEnd.x + (exitPt.x - turnEnd.x)*0.66, y: turnEnd.y + (exitPt.y - turnEnd.y)*0.66},
        P3: exitPt,
        duration: 2.6,
        headingMode: 'fixed',
        heading: turnEndAngle
      }
    ];
    c.state = 'turning-out';
    c.maneuver = { phases, phaseIdx: 0, phaseT: 0 };
  }

  function getBikePos(b) {
    const p = pointOnPath(tract.bikePathFwd, b.t);
    const latOffset = b.dir === 1 ? 4.5 : -4.5;
    return {
      x: p.x + latOffset * Math.cos(p.angle + Math.PI/2),
      y: p.y + latOffset * Math.sin(p.angle + Math.PI/2),
      angle: p.angle
    };
  }

  function updateScene(dt){
    manageSpawns(dt);
    const rawLen = pathTotalLength(tract.carPath);
    if(rawLen <= 0) return; // Cannot update if no path
    const carPathLen = rawLen;
    const bikePathLen = Math.max(1, pathTotalLength(tract.bikePathFwd));

    const drivingCars = entities.cars.filter(c => c.state === 'driving');

    const REACTION = 0.7;
    const MIN_GAP = 6;
    const COMFORT = 0.85;

    drivingCars.forEach(c => {
      c.stopReason = null;
      if(c.isDropOff && c.t >= c.targetDropOffT){
         c.state = 'illegal-stopped';
         c.speed = 0;
         c.dropOffLife = 14;
         c.passengerSpawned = false;
         
         const carPos = pointOnPath(tract.carPath, c.t);
         pushLog('dropoff', '🚗 Sosta temporanea: L\'auto si ferma in carreggiata per far scendere l\'anziano.', 'yield');
         addFlash(carPos.x, carPos.y, 32, 'DISCESA ANZIANO', 'rgba(249,115,22,.85)');
         return;
      }
      const cp = pointOnPath(tract.carPath, c.t);
      if(!cp) return; // Safety check
      let ahead = null;
      let aheadSpeed = 0;
      let minGap = Infinity;
      for(const o of entities.cars){
        if(o === c || o.state === 'done') continue;
        let oDist = o.dist;
        let oSpd = o.speed;
        let virtualDist = o.dist;

        if(o.state === 'maneuver-in' || o.state === 'turning-out' || o.state === 'illegal-stopped'){
          oSpd = 0;
          if(o.state === 'maneuver-in' && o.targetSlot){
             if(!o.targetSlot.isBay) virtualDist -= 45; 
             else virtualDist -= 10;
          } else {
             virtualDist -= 20; 
          }
        }

        const realGap = (oDist - c.dist) - (c.length + o.length)/2;
        const virtualGap = (virtualDist - c.dist) - (c.length + o.length)/2;

        // Only consider vehicles that are actually ahead (positive or slightly negative gap if overlapping)
        if(oDist > c.dist && virtualGap < minGap){ 
           minGap = virtualGap; 
           ahead = o; 
           aheadSpeed = oSpd; 
           c._lastRealGap = realGap; 
        }
      }

      const checkMerge = (list) => {
        for(const e of list){
          if(e.state === 'merging'){
            const mergeDist = e.mergeT * carPathLen;
            const gap = (mergeDist - c.dist) - (c.length + VEHICLE_TYPES[e.type].length)/2;
            if(gap > -15 && gap < minGap){ minGap = gap; ahead = e; aheadSpeed = 0; }
          }
        }
      };
      checkMerge(entities.sideCars);
      checkMerge(entities.drivewayCars);

      let target = c.maxSpeed;
      let braking = false;

      if(entities.ambulance && entities.ambulance.ref !== c){
        const amb = entities.ambulance.ref;
        if(amb && c.dist > amb.dist && c.dist - amb.dist < 220){
          // Panic acceleration to clear the narrow lane!
          target = c.maxSpeed * 1.35;
          c.turnSignal = true;
        } else {
          c.turnSignal = false;
        }
      }

      if(c._crashed && c.crashLife > 0){
        c.crashLife -= dt;
        c.speed = 0; target = 0; braking = false;
        c.turnSignal = true;
        const queueBehind = entities.cars.filter(o => o !== c && o.state === 'driving' && o.dist < c.dist && o.dist > c.dist - 350 && o.speed < 5).length;
        if(queueBehind >= 4 || c.crashLife < 18){
           c.state = 'done';
           pushLog('jam', 'Veicolo incidentato spostato per liberare la corsia.');
        }
        if(c.crashLife <= 0) { c._crashed = false; c.turnSignal = false; }
        return;
      }

      if(ahead){
        const gap = minGap;
        if(gap > 8) c._crashed = false;
        
        const usableGap = gap - MIN_GAP - c.speed * REACTION;
        let vSafe;
        if (usableGap <= 0) {
           vSafe = 0;
        } else {
           vSafe = Math.sqrt(Math.max(0, aheadSpeed*aheadSpeed + 2 * c.decel * COMFORT * usableGap));
        }

        if(vSafe < target){
          target = vSafe;
          if(c.speed > vSafe + 5) braking = true;
          c.stopReason = 'AHEAD';
          if(target < 2) devLog(`car_ahead_${c.id||Math.random()}`, `Auto ${VEHICLE_TYPES[c.type].name} frena per veicolo davanti`, cp.x);
        }
        
        const aheadOnPath = (ahead.state === 'driving' || ahead.state === 'illegal-stopped');
        if(c._lastRealGap < -2 && aheadOnPath){
          const ap = pointOnPath(tract.carPath, ahead.t);
          const realDist = Math.hypot(cp.x - ap.x, cp.y - ap.y);
          if(realDist < (c.length + ahead.length)/2 - 2){
            const blockScenario = ui.scenarioSelect.value === 'block';
            const aheadIllegal = ahead.state === 'illegal-stopped';
            const trueCrashContext = blockScenario && aheadIllegal && c.speed > 35;
            if(trueCrashContext){
              c.stopReason = 'CRASH';
              if(!c._crashed && !ahead._crashed){
                stats.crashes++;
                c._crashed = true; c.crashLife = 60;
                ahead._crashed = true; ahead.crashLife = 60;
                addFlash((cp.x+ap.x)/2,(cp.y+ap.y)/2, 34, 'INCIDENTE', 'rgba(220,38,38,.7)');
                pushLog('crash', `Incidente: ${VEHICLE_TYPES[c.type].name} tampona ${VEHICLE_TYPES[ahead.type].name} (sosta selvaggia).`, 'crash');
              }
            } else {
              c.dist = ahead.dist - (c.length + ahead.length)/2 - 6; // Keep a clean 6-pixel (~1m) visual gap
              c.t = c.dist / carPathLen;
              if(!c._nearMissTs || performance.now() - c._nearMissTs > 4000){
                c._nearMissTs = performance.now();
                pushLog('yield', `${VEHICLE_TYPES[c.type].name}: frenata d'emergenza, incidente evitato.`, 'yield');
              }
            }
            c.speed = 0; target = 0;
          }
        }
      }

      for(const cct of crossingCarTs){
        const crossingDist = cct.carT * carPathLen;
        const distToCrossing = crossingDist - c.dist;
        const lookahead = Math.max(160, c.maxSpeed * 4);
        const stopOffset = c.length/2 + 22;
        if(distToCrossing < stopOffset - 4 || distToCrossing > lookahead) continue;
        
        const crossPos = pointOnPath(tract.carPath, cct.carT);
        const hasPed = entities.peds.some(p => {
          if(p.crossing !== cct.crossing || p.t >= 1) return false;
          const pPos = pointOnPath(p.path, p.t);
          if(cct.crossing.path && cct.crossing.path.length === 4){
             return isPointInPolygon(pPos, cct.crossing.path);
          }
          const near = nearestT(p.path, crossPos);
          return near.d < 28;
        });

        if(!hasPed) continue;
        
        // Final area check: is the car actually overlapping the crossing rectangle?
        const carFront = pointOnPath(tract.carPath, c.t + (c.length/2)/carPathLen);
        const inArea = cct.crossing.path && cct.crossing.path.length === 4 
                       ? isPointInPolygon(carFront, cct.crossing.path)
                       : (distToCrossing < c.length/2 + 25);

        if(distToCrossing < c.length/2 + 10 || inArea){
           c.speed = 0; target = 0; c.stopReason = 'CROSSING';
        } else {
           const stopOffset = c.length/2 + 22;
           const usable = Math.max(0, distToCrossing - stopOffset - 4);
           const vSafe = Math.sqrt(Math.max(0, 2 * c.decel * COMFORT * usable)) - c.speed * REACTION * 0.3;
           const safeTarget = Math.max(0, vSafe);
           if(safeTarget < target){
             target = safeTarget;
             braking = true;
             const pedActive = entities.peds.some(p => p.crossing === cct.crossing && p.t >= 0.03 && p.t <= 0.97 && p.stopReason !== 'CAR_TOO_CLOSE');
             if(distToCrossing < 65 && pedActive){
                target = 0;
                c.stopReason = 'PED_X';
             }
           }
        }
      }



      if(c.illegalStop){
        const distToStop = c.illegalStop.atT * carPathLen - c.dist;
        if(distToStop > 0 && distToStop < 90){
          const brakeDist = (c.speed*c.speed) / (2 * c.decel);
          if(distToStop < brakeDist + 4){ target = 0; braking = true; }
        }
        if(distToStop <= 0){
          c.speed = 0;
          c.state = 'illegal-stopped';
          if(entities.van && entities.van.ref === c){
            entities.van.parked = true;
            entities.van.atT = c.illegalStop.atT;
            entities.van.life = 12 + rand(0, 6);
            pushLog('block', 'Furgone fermo in corsia: la circolazione si congestiona.', 'crash');
          }
          return;
        }
      }

      if(c.targetSlot){
        const slot = c.targetSlot;
        const entryDist = slot.entryT * carPathLen;
        const triggerDist = slot.isBay ? (entryDist - c.length - 10) : (entryDist + c.length/2 + 10);
        const distToTrigger = triggerDist - c.dist;
        if(distToTrigger > -3 && distToTrigger < 80){
          const ramp = Math.max(0, distToTrigger / 70);
          const slowTarget = c.maxSpeed * (0.05 + ramp * 0.65);
          target = Math.min(target, slowTarget);
          braking = c.speed > slowTarget + 4;
        }
        if(c.dist >= triggerDist){
          startManeuver(c, slot);
          trackEvent('yield');
          return;
        }
      }

      c.turnSignal = false;
      if(c.targetSideStreet){
        const street = c.targetSideStreet;
        const entryDist = street.intersectT * carPathLen;
        const triggerDist = entryDist - 15;
        const distToTrigger = triggerDist - c.dist;
        if(distToTrigger > -5 && distToTrigger < 80){
          const ramp = Math.max(0, distToTrigger / 70);
          const slowTarget = c.maxSpeed * (0.15 + ramp * 0.65);
          target = Math.min(target, slowTarget);
          braking = c.speed > slowTarget + 4;
          c.turnSignal = true;
        }
        if(c.dist >= triggerDist){
           const intersectPt = pointOnPath(street.path, street.pathStartT);
           const exitingBusy = entities.sideCars.some(s => s.path === street.path && s.t > 0.85);
           if(bikesNear(intersectPt.x, intersectPt.y, 45)){
             target = 0; braking = true; c.stopReason = 'BIKE_X';
           } else if(exitingBusy){
             target = 0; braking = true; c.stopReason = 'STREET_BUSY';
             devLog(`enter_blocked_${street.id}`, `Entrata traversa occupata da veicolo in uscita`, cp.x);
           } else {
             startTurnIn(c, street);
             return;
           }
        }
      }

      if(c._emergencyHold > 0){
        c._emergencyHold -= dt;
        target = 0;
      }

      // Pendenza: in salita, target ridotto in base a tipo veicolo e ripidità.
      target = target * carSlopeFactor(c.t, c.type, true);

      if(c.speed > target){
        const newSpeed = Math.max(target, c.speed - c.decel * dt);
        if(c.speed - newSpeed > c.decel * dt * 0.6){
          const now = performance.now();
          if(!c.lastBrakeFlash || now - c.lastBrakeFlash > 1500){
            trackEvent('brake');
            c.lastBrakeFlash = now;
          }
        }
        c.speed = newSpeed;
        braking = true;
      } else {
        c.speed = Math.min(target, c.speed + c.accel * dt);
      }
      c.braking = braking;
      c.dist += c.speed * dt;
      c.t = c.dist / carPathLen;
    });

    entities.cars.forEach(c => {
      if(c.state !== 'maneuver-in' && c.state !== 'turning-out') return;
      const done = mAdvance(c.maneuver, dt);
      if(done){
        if(c.state === 'turning-out'){
           c.state = 'done';
           pushLog('turn', `${vDim(c.type).name} ha svoltato in ${c.targetSideStreet.name}.`);
        } else {
           const reservation = entities.parked.find(p => p.id === c.targetSlot.id);
           if(reservation){
             reservation.state = 'parked';
             reservation.animT = 1;
             if(reservation.slot){
               reservation.x = reservation.slot.x;
               reservation.y = reservation.slot.y;
               reservation.angle = reservation.slot.angle;
               reservation.entryT = reservation.slot.entryT;
               reservation.entryAngle = reservation.slot.entryAngle;
               reservation.isBay = reservation.slot.isBay;
             }
           }
           c.state = 'done';
        }
      }
    });

    entities.cars = entities.cars.filter(c => {
      if(c.state === 'done') return false;
      if(c.t >= 1.15){
        if(entities.ambulance && entities.ambulance.ref === c){
          entities.ambulance = null;
        }
        trackEvent('through'); throughCount++;
        return false;
      }
      if(c.state === 'illegal-stopped'){
        if(c.isRoadworks){
          c.roadworksLife -= dt;
          if(c.roadworksLife <= 0){
            c.state = 'done';
            pushLog('roadworks', 'Lavori in corso completati: cantiere rimosso, la corsia è libera.');
            return false;
          }
        }
        if(c.isDropOff){
          c.dropOffLife -= dt;
          if(!c.passengerSpawned && c.dropOffLife < 12){
            c.passengerSpawned = true;
            const carPos = pointOnPath(tract.carPath, c.t);
            const passengerX = carPos.x + 8 * Math.cos(carPos.angle + Math.PI/2);
            const passengerY = carPos.y + 8 * Math.sin(carPos.angle + Math.PI/2);
            const sidewalkX = carPos.x + 22 * Math.cos(carPos.angle + Math.PI/2);
            const sidewalkY = carPos.y + 22 * Math.sin(carPos.angle + Math.PI/2);
            const pedPath = [[passengerX, passengerY], [sidewalkX, sidewalkY]];
            const colors = getRandomPedColors(true, false, false);
            entities.peds.push({
              path: pedPath,
              t: 0,
              dist: 0,
              baseSpeed: 7,
              elderly: true,
              wheelchair: false,
              child: false,
              crossing: null,
              customColors: colors
            });
            pushLog('dropoff', "🚶‍♂️ L'anziano scende dal veicolo ed attraversa lentamente verso il marciapiede.");
          }
          if(c.dropOffLife <= 0){
            c.state = 'driving';
            c.illegalStop = null;
            pushLog('dropoff', 'Discesa completata: l\'auto di cortesia riparte liberando la carreggiata.');
          }
        }
        if(entities.van && entities.van.ref === c){
          entities.van.life -= dt;
          if(entities.van.life <= 0){
            entities.van = null;
            c.state = 'driving';
            c.illegalStop = null;
            pushLog('block', 'Il furgone riparte e libera la corsia.');
          }
        }
        return true;
      }
      return true;
    });

    // NaN cleanup safety
    entities.cars = entities.cars.filter(c => !isNaN(c.dist) && !isNaN(c.t));

    entities.bikes.forEach(b => {
      b.stopReason = null;
      const bp = getBikePos(b);
      let mod = 1;
      const checkProximity = (vx, vy, vehHalf) => {
        const d = Math.hypot(bp.x - vx, bp.y - vy);
        const rStop = vehHalf + 12;   
        const rSlow = vehHalf + 26;   
        if(d < rStop) mod = Math.min(mod, 0.04);
        else if(d < rSlow) mod = Math.min(mod, 0.35);
      };

      for(const p of entities.parked){
        if(p.state === 'reserved' || p.state === 'parked') continue;
        const def = VEHICLE_TYPES[p.vehicleType] || VEHICLE_TYPES.citycar;
        const halfL = def.length/2;
        if(p.maneuver){
          const pos = mPos(p.maneuver);
          checkProximity(pos.x, pos.y, halfL);
        }
      }

      const checkSide = (e) => {
        const def = VEHICLE_TYPES[e.type] || VEHICLE_TYPES.citycar;
        const halfL = def.length/2;
        if(e.state === 'travelling' && e.t > 0.25){
          const ep = pointOnPath(e.path, e.t);
          checkProximity(ep.x, ep.y, halfL);
        } else if(e.state === 'merging'){
          const pos = getMergingCarPos(e);
          checkProximity(pos.x, pos.y, halfL);
        }
      };
      entities.drivewayCars.forEach(checkSide);
      entities.sideCars.forEach(checkSide);

      for(const c of entities.cars){
        if((c.state !== 'maneuver-in' && c.state !== 'turning-out') || !c.maneuver) continue;
        const vSpeed = (c.speed !== undefined) ? c.speed : 0;
        if(vSpeed < 1.5) continue; // Don't yield to stopped vehicles
        const pos = mPos(c.maneuver);
        checkProximity(pos.x, pos.y, c.length/2);
      }

      for(const b2 of entities.bikes){
        if(b2 === b || b2.dir !== b.dir) continue;
        const gap = (b2.dist || 0) - (b.dist || 0);
        if(gap > 0 && gap < 32){
          const usable = gap - 16;
          if (usable <= 0) {
             mod = 0;
          } else {
             const factor = Math.min(1, usable / 14);
             mod = Math.min(mod, factor);
          }
        }
      }

      for(const p of entities.peds){
        if(p.t > 0 && p.t < 1 && p.crossing && p.crossing.intersectsBikePath){
          const pPos = pointOnPath(p.path, p.t);
          const dx = pPos.x - bp.x;
          const dy = pPos.y - bp.y;
          const fwdX = Math.cos(bp.angle);
          const fwdY = Math.sin(bp.angle);
          const dotFwd = dx * fwdX + dy * fwdY;
          const dotRight = dx * (-fwdY) + dy * fwdX;
          
          if(dotFwd > -5 && dotFwd < 42 && Math.abs(dotRight) < 8){
             // Handshake: prioritize movement. 
             // Stop only if ped is actually near the bike path intersection point
             const pPos = pointOnPath(p.path, p.t);
             const bikePathPt = pointOnPath(b.dir === 1 ? tract.bikePathFwd : tract.bikePathRev, b.t);
             const distToBikePath = Math.hypot(pPos.x - bikePathPt.x, pPos.y - bikePathPt.y);
             
             const pedOnStripes = p.t >= 0.15 && p.t <= 0.85;
             const pedYielding = entities.peds.some(px => px.crossing === p.crossing && px.stopReason === 'BIKE_BLOCKING');
             
             if((pedOnStripes && distToBikePath < 25) || (!pedYielding && distToBikePath < 35)){
                mod = 0; b.stopReason = 'PED_X';
             }
          }
          else if(dotFwd > -8 && dotFwd < 65 && Math.abs(dotRight) < 14) mod = Math.min(mod, 0.4);
        }
      }

      if(b._emergencyHold > 0){
        b._emergencyHold -= dt;
        mod = 0;
      }
      
      // Pendenza: forte rallentamento in salita per le bici, lieve spinta in discesa.
      const bikeSlope = bikeSlopeFactor(b.t, b.dir === 1);
      b.speed = b.baseSpeed * mod * bikeSlope;
      b.dist += b.speed * dt;
      b.t = b.dir === 1 ? (b.dist / bikePathLen) : (1 - b.dist / bikePathLen);
    });
    entities.bikes = entities.bikes.filter(b => b.t > -0.15 && b.t < 1.15);

    const isPointInVehicle = (vx, vy, vAngle, vLen, vWid, px, py, padding) => {
       const dx = px - vx;
       const dy = py - vy;
       const cos = Math.cos(-vAngle);
       const sin = Math.sin(-vAngle);
       const localX = dx * cos - dy * sin;
       const localY = dx * sin + dy * cos;
       return Math.abs(localX) < (vLen/2 + padding) && Math.abs(localY) < (vWid/2 + padding);
    };

    entities.peds.forEach(p => {
      const len = pathTotalLength(p.path);
      const pPos = pointOnPath(p.path, p.t);
      let pedMod = 1; p.stopReason = null;

      // Intelligence & Self-preservation: check for ANY vehicle nearby that might be blocking the path
      const checkProximity = (list) => {
        for(const v of list){
          const def = VEHICLE_TYPES[v.type] || {length:30, width:16};
          let vPos, vAngle;
          if(v.state === 'merging'){
            const pos = getMergingCarPos(v);
            vPos = pos;
            vAngle = pos.angle;
          } else if(v.state === 'driving' || v.state === 'travelling' || v.state === 'yielding' || v.state === 'illegal-stopped'){
             const path = v.path || tract.carPath;
             vPos = pointOnPath(path, v.t);
             vAngle = vPos.angle;
          } else if(v.maneuver){
             vPos = mPos(v.maneuver);
             vAngle = mHeading(v.maneuver);
          }
          if(!vPos) continue;
          
          const dx = pPos.x - vPos.x;
          const dy = pPos.y - vPos.y;
          const cos = Math.cos(-vAngle);
          const sin = Math.sin(-vAngle);
          const lx = dx * cos - dy * sin;
          const ly = dx * sin + dy * cos;
 
          const scale = tract.scale || 1.0;
          let vSpeed = v.speed;
          if(vSpeed === undefined && (v.state === 'yielding' || v.state === 'parking' || v.state === 'maneuver-in')){
             vSpeed = 0;
          } else if(vSpeed === undefined){
             vSpeed = v.baseSpeed || 0;
          }
          
          if(lx > -def.length/2 - 10*scale && lx < def.length/2 + 2*scale && Math.abs(ly) < def.width/2 + 8*scale){
             const isCarMoving = vSpeed > 2.0;
             const isOverlappingDeep = Math.abs(lx) < def.length/2 - 5*scale;
             if(isCarMoving || isOverlappingDeep){
                pedMod = 0; p.stopReason = 'VEHICLE_IN_WAY'; return true;
             }
          }
        }
        return false;
      };
      
      if(pedMod > 0) checkProximity(entities.cars);
      if(pedMod > 0) checkProximity(entities.sideCars);
      if(pedMod > 0) checkProximity(entities.drivewayCars);

      // Check for bikes on any path (including bike lanes)
      if(pedMod > 0){
        const s = (tract && tract.scale) ? tract.scale : 1.0;
        for(const b of entities.bikes){
           const bp = getBikePos(b);
           if(Math.hypot(pPos.x - bp.x, pPos.y - bp.y) < 12 * s){ 
             if(b.speed > 0.5 * s){
               pedMod = 0; p.stopReason = 'BIKE_BLOCKING'; break; 
             }
           }
        }
      }

      if(pedMod > 0 && p.crossing && p.t < 0.15){
        p._waitElapsed = (p._waitElapsed || 0);
        if(p._waitElapsed < 5){
          const carPathLen = pathTotalLength(tract.carPath);
          for(const c of entities.cars){
            if(c.state !== 'driving' || c.speed < 25) continue;
            const distAlong = nearestCarT(pPos).t * carPathLen - c.dist;
            if(distAlong <= 4 || distAlong > 130) continue;
            const brakeDist = (c.speed * c.speed) / (2 * c.decel);
            if(distAlong < brakeDist + 30){
              pedMod = 0; p.stopReason = 'CAR_TOO_CLOSE';
              p._waitElapsed += dt;
              break;
            }
          }
        }
      }



      const stepDist = p.baseSpeed * pedMod * dt;
      const nextDist = (p.dist || 0) + stepDist;
      p.dist = nextDist;
      p.t = nextDist / len;
    });
    entities.peds = entities.peds.filter(p => p.t < 1.15);

    const updateExitPath = (e, list, mergeDuration) => {
      const findLeader = () => {
        let leader = null;
        for(const o of list){
          if(o === e || o.path !== e.path || o.state === 'done') continue;
          if((o.dist || 0) > (e.dist || 0)){
            if(!leader || (o.dist || 0) < (leader.dist || 0)) leader = o;
          }
        }
        return leader;
      };

      if(e.state === 'travelling'){
        const len = pathTotalLength(e.path);
        const eLen = vDim(e.type).length;
        
        if(e._yieldDist === undefined){
          let minD = Infinity;
          let intersectT = 1;
          for(let tt=0.5; tt<=1; tt+=0.02){
             const pt = pointOnPath(e.path, tt);
             const near = nearestCarT(pt);
             if(near.d < minD){ minD = near.d; intersectT = tt; }
          }
          let originalIntersect = intersectT;
          for(let tt=0.2; tt<=originalIntersect; tt+=0.02){
             const pt = pointOnPath(e.path, tt);
             const nearBike = nearestBikeT(pt);
             if(nearBike.d < 15){
                intersectT = Math.min(intersectT, tt);
                break;
             }
          }
          e._yieldDist = Math.max(0, intersectT * len - eLen/2 - 6);
        }
        
        const yieldDist = e._yieldDist;
        const yieldT = yieldDist / len;

        const pos = pointOnPath(e.path, Math.min(1, e.t));
        let mod = 1;
        
        const leader = findLeader();
        if(leader){
          const leaderLen = vDim(leader.type).length;
          const gap = (leader.dist || 0) - (e.dist || 0) - (eLen + leaderLen)/2;
          // Stricter stacking: larger gap and more aggressive braking
          const safeGap = 14; 
          if(gap < 45){
             const usable = Math.max(0, gap - safeGap);
             mod = Math.min(mod, usable / 28);
             if(gap < safeGap) mod = 0;
          }
        }
        
        const nearBike = nearestBikeT(pos);
        if(nearBike.d < 22 && bikesNear(pos.x, pos.y, 24)){
          mod = Math.min(mod, 0.04); e.yieldingToBike = true;
        } else {
          e.yieldingToBike = false;
          // Check for cars turning IN to this street
          const carTurningIn = entities.cars.some(c => c.targetSideStreet && c.targetSideStreet.path === e.path && c.dist > (c.targetSideStreet.intersectT * pathTotalLength(tract.carPath) - 60));
          if(carTurningIn && e.t > 0.8){
            mod = 0; e.stopReason = 'WAIT_ENTRY';
            devLog(`exit_yield_${e.id}`, `Veicolo in uscita attende veicolo in entrata per evitare stallo`, pos.x);
          }
        }
        
        for(const p of entities.peds){
          if(p.t > 0 && p.t < 1){
            const pPos = pointOnPath(p.path, p.t);
            const d = Math.hypot(pos.x - pPos.x, pos.y - pPos.y);
            // Increased awareness: stop earlier and slow down more smoothly
            if(d < eLen/2 + 28) mod = 0;
            else if(d < eLen/2 + 60) mod = Math.min(mod, 0.25);
          }
        }
        
        if(e._emergencyHold > 0){
          e._emergencyHold -= dt;
          mod = 0;
        }

        e.dist = (e.dist || 0) + e.baseSpeed * mod * dt;
        e.t = e.dist / len;
        
        if(e.t >= yieldT - 0.001){
          const endPt = pointOnPath(e.path, e.t);
          const intersectPt = pointOnPath(e.path, yieldDist/len + (eLen/2 + 6)/len);
          const near = nearestCarT(intersectPt);
          if(near.d < 80){
            if(e.dist >= yieldDist && e.state === 'travelling'){
              e.dist = yieldDist; e.t = e.dist / len;
              e.state = 'yielding';
              e.mergeT = near.t;
              e.mergeStart = endPt;
              e.mergeEnd = pointOnPath(tract.carPath, near.t);
              e.mergeAngle0 = endPt.angle; e.mergeAngle1 = e.mergeEnd.angle;
              e.yieldT = 0; e.mergeAnimT = 0;
            }
          }
          if(e.t >= 1.15) e.state = 'done';
        }
      } else if(e.state === 'yielding'){
        e.yieldT += dt;
        const leader = findLeader();
        if(leader && leader.state !== 'done'){
          return;
        }
        const pedsNear = (x, y, r) => entities.peds.some(p => !p.dead && p.t>0 && p.t<1 && Math.hypot(x - pointOnPath(p.path, p.t).x, y - pointOnPath(p.path, p.t).y) < r);
        if(isMergePathClear(e.mergeT, e.yieldT, e.path) && !bikesNear(e.mergeStart.x, e.mergeStart.y, 65) && !bikesNear(e.mergeEnd.x, e.mergeEnd.y, 65) && !pedsNear(e.mergeStart.x, e.mergeStart.y, 24) && !pedsNear(e.mergeEnd.x, e.mergeEnd.y, 24)){
          e.state = 'merging';
          if(e.yieldT > 0.4) trackEvent('yield');
        }
      } else if(e.state === 'merging'){
        if(e.mergeAnimT < 1) e.mergeAnimT += dt / mergeDuration;
        if(e.mergeAnimT >= 1){
          e.mergeAnimT = 1; // pin at end of merge animation
          const carPathLen = pathTotalLength(tract.carPath);
          const mergeDist = e.mergeT * carPathLen;
          const newLen = VEHICLE_TYPES[e.type].length;
          const tooClose = entities.cars.some(c => {
            if(c.state !== 'driving' && c.state !== 'illegal-stopped') return false;
            const gap = mergeDist - c.dist - (newLen + c.length)/2;
            return gap > -newLen && gap < 22;
          });
          if(!tooClose){
            const baseRoadSpeed = carBaseSpeed() * VEHICLE_TYPES[e.type].speedFactor;
            entities.cars.push(makeCar({type:e.type, startT: e.mergeT, speed: baseRoadSpeed * 0.55, customColors: e.customColors}));
            e.state = 'done';
          }
          // Se tooClose: l'auto resta visibile al termine del merge in attesa che il flusso si liberi.
        }
      }
    };
    
    entities.drivewayCars.forEach(d => updateExitPath(d, entities.drivewayCars, 1.4));
    entities.drivewayCars = entities.drivewayCars.filter(d => d.state !== 'done');

    entities.sideCars.forEach(s => updateExitPath(s, entities.sideCars, 1.5));
    entities.sideCars = entities.sideCars.filter(s => s.state !== 'done');

    entities.reverseCars.forEach(c => {
      // Leader is the closest reverseCar ahead, on the same logical track.
      const findRevLeader = () => {
        return entities.reverseCars
          .filter(o => o !== c && o.state !== 'done')
          .map(o => {
            // Compute "linear progression" so any state ahead is detected.
            let p = 0;
            if(o.state === 'entering') p = o.entryDist;
            else if(o.state === 'reverse') p = c.entryLen + o.dist;
            else if(o.state === 'exiting') p = c.entryLen + c.revLen + o.exitDist;
            return {o, p};
          })
          .filter(x => {
            let cp = 0;
            if(c.state === 'entering') cp = c.entryDist;
            else if(c.state === 'reverse') cp = c.entryLen + c.dist;
            else if(c.state === 'exiting') cp = c.entryLen + c.revLen + c.exitDist;
            return x.p > cp;
          })
          .sort((a,b) => a.p - b.p)[0];
      };
      const applyLeader = (curP) => {
        const lead = findRevLeader();
        if(!lead) return 1;
        const gap = lead.p - curP - (c.length + lead.o.length)/2;
        if(gap >= 45) return 1;
        const safeGap = 14;
        if(gap < safeGap) return 0;
        return Math.max(0, (gap - safeGap)/28);
      };

      if(c.state === 'entering'){
        const curP = c.entryDist;
        const mod = applyLeader(curP);
        // L'auto è ancora nella traversa: nessuna pendenza significativa sul viale.
        c.entryDist += c.baseSpeed * mod * dt;
        if(c.entryDist >= c.entryLen){
          c.state = 'reverse';
          c.dist = 0; c.t = 0;
        }
      } else if(c.state === 'reverse'){
        const curP = c.entryLen + c.dist;
        const mod = applyLeader(curP);
        // Le auto contromano percorrono il viale in senso inverso → effettivamente in discesa.
        // Per stimare la pendenza nel punto, ricavo la posizione corrispondente sul carPath.
        const revPos = pointOnPath(c.revPath, Math.min(1, Math.max(0, c.t)));
        const carT = nearestCarT(revPos).t;
        const slopeMod = carSlopeFactor(carT, c.type, false);
        c.dist += c.baseSpeed * mod * slopeMod * dt;
        c.t = c.dist / c.revLen;
        const exitDist = c.exitT_on_rev * c.revLen;
        if(c.dist >= exitDist){
          c.state = 'exiting';
          c.exitDist = 0;
        }
      } else if(c.state === 'exiting'){
        const curP = c.entryLen + c.revLen + c.exitDist;
        const mod = applyLeader(curP);
        c.exitDist += c.baseSpeed * mod * dt;
        if(c.exitDist >= c.exitLen + 20) c.state = 'done';
      }
    });
    entities.reverseCars = entities.reverseCars.filter(c => c.state !== 'done');

    entities.parked.forEach(p => {
      if(p.state === 'parking'){
        // The maneuver is advanced by the car in entities.cars.
        // We just ensure slot coordinates are copied when it transitions to parked.
        if (p.slot && p.x === undefined) {
          p.x = p.slot.x;
          p.y = p.slot.y;
          p.angle = p.slot.angle;
          p.entryT = p.slot.entryT;
          p.entryAngle = p.slot.entryAngle;
          p.isBay = p.slot.isBay;
        }
      } else if(p.state === 'unparking'){
        if(!p.maneuver){
           const entryT = p.entryT || (p.slot && p.slot.entryT);
           const slotDist = entryT * pathTotalLength(tract.carPath);
           const isClear = !entities.cars.some(c => (c.state === 'driving' || c.state === 'illegal-stopped') && c.dist > slotDist - 90 && c.dist < slotDist + 20);
           if(isClear) startUnpark(p);
        }
        if(p.maneuver){
          if(!p.maneuverDone) p.maneuverDone = mAdvance(p.maneuver, dt);
          if(p.maneuverDone){
            const last = p.maneuver.phases[p.maneuver.phases.length-1];
            const endPos = {x: last.P3.x, y: last.P3.y};
            const near = nearestCarT(endPos);
            const newLen = VEHICLE_TYPES[p.vehicleType].length;
            const carPathLen = pathTotalLength(tract.carPath);
            const mergeDist = near.t * carPathLen;
            const tooClose = entities.cars.some(c => {
              if(c.state !== 'driving' && c.state !== 'illegal-stopped') return false;
              const gap = mergeDist - c.dist - (newLen + c.length)/2;
              return gap > -newLen && gap < 22;
            });
            if(!tooClose){
              entities.cars.push(makeCar({type: p.vehicleType, startT: near.t, speed: 0, customColors: p.customColors}));
              p.state = 'empty';
            }
            // Se tooClose: il veicolo che esce dal parcheggio resta visibile a fine manovra
            // finché il flusso principale non si libera (no più sparizione).
          }
        }
      }
    });
    entities.parked = entities.parked.filter(p => p.state !== 'empty');



    const scenarioAllowsImpact = ['delivery_block','vulnerable_users','roadworks','dropoff','ambulance'].includes(ui.scenarioSelect.value);
    const checkPedCrash = (veh, vx, vy, vAngle, vLen, vWid, vname, speed) => {
       if(speed !== undefined && speed < 5) return;
        entities.peds.forEach(p => {
          if(p.dead || p.t <= 0 || p.t >= 1) return;
          const pp = pointOnPath(p.path, p.t);
          
          const dx = pp.x - vx;
          const dy = pp.y - vy;
          const cos = Math.cos(-vAngle);
          const sin = Math.sin(-vAngle);
          const lx = dx * cos - dy * sin;
          const ly = dx * sin + dy * cos;

          const inCollision = Math.abs(lx) < (vLen/2 - 1.5) && Math.abs(ly) < (vWid/2 - 1.5);
          const inFront = lx > vLen/2 && lx < (vLen/2 + 20) && Math.abs(ly) < (vWid/2 + 5.5); // Stopped earlier (20px/~3m buffer) to prevent graphical overlap
          
          if(!inCollision && !inFront) return;

          if(inCollision && (speed > 18 || veh._emergencyHold > 0)){
            p.dead = true;
            veh._crashed = true; veh.crashLife = 60; veh.speed = 0;
            stats.crashes++;
            addFlash(pp.x, pp.y, 25, 'INVESTIMENTO PEDONE', 'rgba(220,38,38,.9)');
            pushLog('crash', `Pedone investito da ${vname}!`, 'crash');
          } else if(inFront) {
            veh.speed = 0;
            veh._emergencyHold = 0.8; // Hold at 0 for 0.8 seconds to avoid "creeping"
            if(!veh._nearMissTs || performance.now() - veh._nearMissTs > 6000){
              veh._nearMissTs = performance.now();
              stats.nearMisses++;
              pushLog('yield', `${vname}: frenata d'emergenza per pedone.`, 'yield');
            }
          }
        });
    };
    const checkBikeCrash = (veh, vx, vy, vAngle, vLen, vWid, vname, speed) => {
       if(speed !== undefined && speed < 6) return;
        entities.bikes.forEach(b => {
          if(b.dead || b.t <= 0 || b.t >= 1) return;
          const bp = getBikePos(b);
          
          const dx = bp.x - vx;
          const dy = bp.y - vy;
          const cos = Math.cos(-vAngle);
          const sin = Math.sin(-vAngle);
          const lx = dx * cos - dy * sin;
          const ly = dx * sin + dy * cos;

          const inCollision = Math.abs(lx) < (vLen/2 - 1) && Math.abs(ly) < (vWid/2 - 1);
          const inFront = lx > vLen/2 && lx < (vLen/2 + 22) && Math.abs(ly) < (vWid/2 + 6.0); // Stopped earlier (22px/~3m buffer) to prevent graphical overlap
          
          if(!inCollision && !inFront) return;

          if(inCollision && speed > 15){
            b.dead = true;
            veh._crashed = true; veh.crashLife = 60; veh.speed = 0;
            stats.crashes++;
            addFlash(bp.x, bp.y, 25, 'INCIDENTE BICI', 'rgba(220,38,38,.9)');
            pushLog('crash', `Ciclista investito da ${vname}!`, 'crash');
          } else if(inFront) {
            if(speed > 10){
              veh.speed = 0;
              if(!veh._nearMissTs || performance.now() - veh._nearMissTs > 6000){
                veh._nearMissTs = performance.now();
                stats.nearMisses++;
                pushLog('yield', `${vname}: frenata d'emergenza per ciclista.`, 'yield');
              }
            }
          }
        });
    };

    entities.cars.forEach(c => {
       if(c.state === 'driving'){
         const cp = pointOnPath(tract.carPath, c.t);
         const def = vDim(c.type);
         checkPedCrash(c, cp.x, cp.y, cp.angle, def.length, def.width, def.name, c.speed);
         checkBikeCrash(c, cp.x, cp.y, cp.angle, def.length, def.width, def.name, c.speed);
       }
    });

    const checkSideVehicleCrash = (list) => {
      list.forEach(e => {
        const def = VEHICLE_TYPES[e.type];
        if(e.state === 'travelling'){
           const ep = pointOnPath(e.path, Math.min(1, e.t));
           checkPedCrash(e, ep.x, ep.y, ep.angle, def.length, def.width, def.name, e.baseSpeed);
           checkBikeCrash(e, ep.x, ep.y, ep.angle, def.length, def.width, def.name, e.baseSpeed);
        } else if(e.state === 'merging'){
           const pos = getMergingCarPos(e);
           checkPedCrash(e, pos.x, pos.y, pos.angle, def.length, def.width, def.name, e.baseSpeed);
           checkBikeCrash(e, pos.x, pos.y, pos.angle, def.length, def.width, def.name, e.baseSpeed);
        }
      });
    };
    checkSideVehicleCrash(entities.sideCars);
    checkSideVehicleCrash(entities.drivewayCars);
    
    entities.bikes.forEach(b => {
      if(b.dead) return;
      const bp = getBikePos(b);
      entities.peds.forEach(p => {
         if(p.dead || p.t <= 0 || p.t >= 1) return;
         const pp = pointOnPath(p.path, p.t);
         const dist = Math.hypot(bp.x - pp.x, bp.y - pp.y);
         if(dist < 15){
           if(b.speed > 14 && dist < 5){
             p.dead = true;
             b.dead = true;
             stats.crashes++;
             addFlash(pp.x, pp.y, 20, 'SCONTRO BICI-PEDONE', 'rgba(220,38,38,.9)');
             pushLog('crash', `Scontro tra bici e pedone!`, 'crash');
           } else {
             b.speed = 0;
             b._emergencyHold = 0.6;
             if(!b._nearMissTs || performance.now() - b._nearMissTs > 4000){
                b._nearMissTs = performance.now();
                stats.nearMisses++;
                pushLog('yield', `Ciclista: frenata per pedone.`, 'yield');
             }
           }
         }
      });
    });

    entities.peds = entities.peds.filter(p => !p.dead && p.t < 1.15);
    entities.bikes = entities.bikes.filter(b => !b.dead && b.t > -0.15 && b.t < 1.15);

    flashes.forEach(f => f.life -= dt * 1.4);
    flashes = flashes.filter(f => f.life > 0);

    // Idle CO2 emissions calculation
    entities.cars.forEach(c => {
      if ((c.state === 'driving' || c.state === 'illegal-stopped') && c.t > 0 && c.t < 1 && c.speed < 2.0) {
        const rates = {citycar: 0.45, suv: 0.65, van: 0.90, truck: 1.40, motorbike: 0.20, ambulance: 0.80};
        const rate = rates[c.type] || 0.45;
        excessCO2 += rate * dt;
      }
    });
    entities.sideCars.forEach(sc => {
      if (sc.state === 'yielding' || (sc.state === 'travelling' && sc.t > 0 && sc.speed < 2.0)) {
        const rates = {citycar: 0.45, suv: 0.65, van: 0.90, truck: 1.40, motorbike: 0.20, ambulance: 0.80};
        const rate = rates[sc.type] || 0.45;
        excessCO2 += rate * dt;
      }
    });
    entities.drivewayCars.forEach(dc => {
      if (dc.state === 'yielding' || (dc.state === 'travelling' && dc.t > 0 && dc.speed < 2.0)) {
        const rates = {citycar: 0.45, suv: 0.65, van: 0.90, truck: 1.40, motorbike: 0.20, ambulance: 0.80};
        const rate = rates[dc.type] || 0.45;
        excessCO2 += rate * dt;
      }
    });

    updateStats();
  }

  const HOTSPOT_COLORS = {
    junction: {fill:'rgba(37,99,235,.10)', stroke:'rgba(37,99,235,.55)'},
    crossing: {fill:'rgba(15,23,42,.08)',  stroke:'rgba(15,23,42,.45)'},
    driveway: {fill:'rgba(124,58,237,.10)',stroke:'rgba(124,58,237,.55)'},
    disabled: {fill:'rgba(220,38,38,.10)', stroke:'rgba(220,38,38,.55)'}
  };

  function drawPath(points, color, dash=[], width=3){
    if(!points || points.length<2) return;
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap='round'; ctx.lineJoin='round';
    ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(points[0][0], points[0][1]);
    for(let i=1;i<points.length;i++) ctx.lineTo(points[i][0], points[i][1]);
    ctx.stroke(); ctx.restore();
  }

  function shade(hex, percent){
    if(typeof hex !== 'string' || !hex.startsWith('#')) return hex;
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    const f = 1 + percent/100;
    const cl = v => Math.max(0,Math.min(255,Math.round(v*f)));
    return `rgb(${cl(r)},${cl(g)},${cl(b)})`;
  }

  function getRandomVehicleColors(type){
    const list = {
      citycar: [
        {body:'#dc2626', accent:'#991b1b'}, // Rosso corsa
        {body:'#2563eb', accent:'#1d4ed8'}, // Blu reale
        {body:'#64748b', accent:'#475569'}, // Grigio metallico
        {body:'#374151', accent:'#1f2937'}, // Grigio grafite
        {body:'#059669', accent:'#047857'}, // Verde foresta
        {body:'#eab308', accent:'#ca8a04'}, // Giallo limone
        {body:'#ea580c', accent:'#c2410c'}, // Arancione sport
        {body:'#8b5cf6', accent:'#6d28d9'}  // Viola ametista
      ],
      suv: [
        {body:'#1e293b', accent:'#020617'}, // Nero carbonio
        {body:'#475569', accent:'#334155'}, // Grigio scuro
        {body:'#b45309', accent:'#78350f'}, // Bronzo caldo
        {body:'#0f766e', accent:'#115e59'}, // Verde petrolio
        {body:'#3f6212', accent:'#1a2e05'}  // Verde oliva militar
      ],
      van: [
        {body:'#4b5563', accent:'#1f2937'}, // Grigio antracite
        {body:'#94a3b8', accent:'#64748b'}, // Grigio metallo
        {body:'#f59e0b', accent:'#d97706'}, // Giallo spedizioni
        {body:'#1e3a8a', accent:'#172554'}, // Blu profondo
        {body:'#b91c1c', accent:'#7f1d1d'}  // Rosso corriere
      ],
      truck: [
        {body:'#d97706', accent:'#92400e'}, // Arancione cantiere
        {body:'#1d4ed8', accent:'#1e3a8a'}, // Blu industriale
        {body:'#dc2626', accent:'#991b1b'}, // Rosso carico
        {body:'#15803d', accent:'#166534'}  // Verde tecnico
      ],
      motorbike: [
        {body:'#fbbf24', accent:'#b45309'}, // Giallo corsa
        {body:'#ef4444', accent:'#991b1b'}, // Rosso fuoco
        {body:'#10b981', accent:'#065f46'}, // Verde ninja
        {body:'#0f172a', accent:'#020617'}, // Nero opaco
        {body:'#f97316', accent:'#ea580c'}  // Arancione cross
      ],
      ambulance: [
        {body:'#f8fafc', accent:'#dc2626'}
      ]
    };
    const choices = list[type] || [{body:'#3b82f6', accent:'#1d4ed8'}];
    const pick = choices[Math.floor(rand(0, choices.length))];
    const s = (tract && tract.scale) ? tract.scale : 1.0;
    const def = VEHICLE_TYPES[type] || VEHICLE_TYPES.citycar;
    return {
      body: pick.body,
      accent: pick.accent,
      glass: type === 'motorbike' ? '#fecaca' : '#bfdbfe',
      length: def.length * s,
      width: def.width * s
    };
  }

  function getRandomBikeColors(){
    const frames = ['#ea580c', '#3b82f6', '#10b981', '#ef4444', '#a855f7', '#0f172a', '#eab308'];
    const helmets = ['#1e293b', '#e2e8f0', '#dc2626', '#1d4ed8', '#16a34a', '#d97706'];
    const shirts = ['#f59e0b', '#3b82f6', '#10b981', '#ec4899', '#f43f5e', '#6366f1', '#14b8a6'];
    return {
      frame: frames[Math.floor(rand(0, frames.length))],
      helmet: helmets[Math.floor(rand(0, helmets.length))],
      shirt: shirts[Math.floor(rand(0, shirts.length))]
    };
  }

  function getRandomPedColors(elderly=false, wheelchair=false, child=false){
    const hairColors = elderly 
      ? ['#e2e8f0', '#cbd5e1', '#94a3b8', '#ffffff']
      : ['#f59e0b', '#7c2d12', '#0f172a', '#b45309', '#ca8a04', '#1e293b'];
      
    const clothesColors = child
      ? ['#ef4444', '#3b82f6', '#10b981', '#ec4899', '#f43f5e', '#6366f1', '#eab308']
      : ['#1e293b', '#0284c7', '#059669', '#b91c1c', '#4f46e5', '#db2777', '#d97706', '#475569'];
      
    const caneColors = ['#78350f', '#451a03', '#1e293b', '#b45309'];
    const backpackColors = ['#f43f5e', '#06b6d4', '#eab308', '#a855f7', '#10b981'];
    
    return {
      hair: hairColors[Math.floor(rand(0, hairColors.length))],
      clothes: clothesColors[Math.floor(rand(0, clothesColors.length))],
      cane: caneColors[Math.floor(rand(0, caneColors.length))],
      backpack: backpackColors[Math.floor(rand(0, backpackColors.length))]
    };
  }

    function drawVehicle(x, y, angle, type, opts={}){
    const def = opts.customColors || vDim(type);
    const L = def.length || vDim(type).length, W = def.width || vDim(type).width;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(angle);
    ctx.fillStyle = 'rgba(15,23,42,.2)';
    ctx.beginPath(); ctx.roundRect(-L/2, -W/2 + 2, L, W, Math.min(W/2, 6)); ctx.fill();

    if(type === 'motorbike'){
      ctx.fillStyle = def.body;
      ctx.beginPath(); ctx.roundRect(-L/2, -W/2, L, W, W/2); ctx.fill();
      ctx.strokeStyle = def.accent; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#1e293b';
      ctx.beginPath(); ctx.arc(0, 0, W*0.6, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = def.glass;
      ctx.beginPath(); ctx.arc(0, 0, W*0.35, 0, Math.PI*2); ctx.fill();
    } else if(type === 'van' || type === 'truck'){
      const grad = ctx.createLinearGradient(0, -W/2, 0, W/2);
      grad.addColorStop(0, def.body);
      grad.addColorStop(1, shade(def.body, -15));
      ctx.fillStyle = grad;
      ctx.strokeStyle = def.accent; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.roundRect(-L/2, -W/2, L, W, 3); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = def.accent; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(L/2 - L*0.32, -W/2); ctx.lineTo(L/2 - L*0.32, W/2); ctx.stroke();
      ctx.fillStyle = def.glass;
      ctx.beginPath(); ctx.roundRect(L/2 - L*0.30, -W/2 + 2, L*0.22, W - 4, 1.5); ctx.fill();
      if(opts.braking){
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(-L/2, -W/2 + 2, 2.5, 3); ctx.fillRect(-L/2, W/2 - 5, 2.5, 3);
      } else {
        ctx.fillStyle = '#fef3c7';
        ctx.fillRect(L/2 - 2.5, -W/2 + 2, 2.5, 3); ctx.fillRect(L/2 - 2.5, W/2 - 5, 2.5, 3);
      }
    } else if(type === 'ambulance'){
      const grad = ctx.createLinearGradient(0, -W/2, 0, W/2);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(1, '#f1f5f9');
      ctx.fillStyle = grad;
      ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.roundRect(-L/2, -W/2, L, W, 4); ctx.fill(); ctx.stroke();
      
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(-L/2, -W/2 + 2, L, 2.5);
      ctx.fillRect(-L/2, W/2 - 4.5, L, 2.5);
      
      ctx.fillStyle = '#2563eb';
      ctx.fillRect(-2, -5, 4, 10);
      ctx.fillRect(-5, -2, 10, 4);
      
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath(); ctx.roundRect(L/2 - L*0.30, -W/2 + 2.5, L*0.20, W - 5, 1.5); ctx.fill();
      
      const blink = (Math.floor(performance.now() / 150) % 2) === 0;
      if (blink) {
        ctx.fillStyle = '#06b6d4';
        ctx.beginPath(); ctx.arc(L/2 - 4, -W/2, 3, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(-L/2 + 4, W/2, 3, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#2563eb';
        ctx.beginPath(); ctx.arc(L/2 - 4, W/2, 3, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(-L/2 + 4, -W/2, 3, 0, Math.PI*2); ctx.fill();
      } else {
        ctx.fillStyle = '#2563eb';
        ctx.beginPath(); ctx.arc(L/2 - 4, -W/2, 3, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(-L/2 + 4, W/2, 3, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#06b6d4';
        ctx.beginPath(); ctx.arc(L/2 - 4, W/2, 3, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(-L/2 + 4, -W/2, 3, 0, Math.PI*2); ctx.fill();
      }
    } else {
      const grad = ctx.createLinearGradient(0, -W/2, 0, W/2);
      grad.addColorStop(0, def.body);
      grad.addColorStop(1, shade(def.body, -22));
      ctx.fillStyle = grad;
      ctx.strokeStyle = def.accent; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(-L/2, -W/2, L, W, 5); ctx.fill(); ctx.stroke();
      ctx.fillStyle = def.glass;
      ctx.beginPath(); ctx.roundRect(L/2 - L*0.40, -W/2 + 2, L*0.22, W - 4, 1.5); ctx.fill();
      ctx.beginPath(); ctx.roundRect(-L/2 + L*0.18, -W/2 + 2, L*0.22, W - 4, 1.5); ctx.fill();
      ctx.strokeStyle = shade(def.body, -30); ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.moveTo(-L*0.05, -W/2 + 2); ctx.lineTo(-L*0.05, W/2 - 2); ctx.stroke();
      if(opts.braking){
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(-L/2, -W/2 + 2, 2, 3); ctx.fillRect(-L/2, W/2 - 5, 2, 3);
      } else {
        ctx.fillStyle = '#fde68a';
        ctx.fillRect(L/2 - 2, -W/2 + 2, 2, 3); ctx.fillRect(L/2 - 2, W/2 - 5, 2, 3);
      }
    }
    if(opts.turnSignal){
      const blink = (Math.floor(performance.now()/350) % 2) === 0;
      if(blink){
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath(); ctx.arc(L/2-2, -W/2, 2.5, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(L/2-2, W/2, 2.5, 0, Math.PI*2); ctx.fill();
      }
    }
    if(opts.disabled){
      ctx.fillStyle = '#fff'; ctx.font = `700 ${Math.round(W*0.7)}px Inter`;
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText('♿', 0, 0);
    }
    if(opts.hazard){
      const blink = (Math.floor(performance.now()/350) % 2) === 0;
      if(blink){
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath(); ctx.arc(L/2-2, -W/2-1, 2, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(L/2-2, W/2+1, 2, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(-L/2+2, -W/2-1, 2, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(-L/2+2, W/2+1, 2, 0, Math.PI*2); ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawBike(x, y, angle, dir, customColors){
    const s = (tract && tract.scale) ? tract.scale : 1.0;
    const colors = customColors || { frame: '#ea580c', helmet: '#1e293b', shirt: '#f59e0b' };
    ctx.save();
    ctx.translate(x,y); 
    ctx.rotate(angle);
    ctx.scale(s, s);
    if(dir === -1) ctx.scale(-1, 1);
    ctx.fillStyle = 'rgba(15,23,42,.18)';
    ctx.beginPath(); ctx.ellipse(0,3,12,4,0,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(-8,2,4,0,Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.arc(8,2,4,0,Math.PI*2); ctx.stroke();
    ctx.strokeStyle = colors.frame; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-8,2); ctx.lineTo(0,-2); ctx.lineTo(8,2);
    ctx.moveTo(0,-2); ctx.lineTo(2,-7);
    ctx.stroke();
    ctx.fillStyle = colors.helmet;
    ctx.beginPath(); ctx.arc(2,-9,2.6,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = colors.shirt;
    ctx.beginPath(); ctx.roundRect(-2,-7,8,5,1.5); ctx.fill();
    ctx.restore();
  }

  function drawPed(x, y, wheelchair=false, elderly=false, child=false, customColors=null){
    const s = (tract && tract.scale) ? tract.scale : 1.0;
    const colors = customColors || { hair: '#fbbf24', clothes: '#1e293b', cane: '#78350f' };
    ctx.save();
    ctx.translate(x,y);
    ctx.scale(s, s);
    ctx.fillStyle = 'rgba(15,23,42,.18)';
    ctx.beginPath(); ctx.ellipse(0,5,5,2,0,0,Math.PI*2); ctx.fill();
    if(wheelchair){
      ctx.fillStyle = colors.clothes;
      ctx.beginPath(); ctx.arc(0,-2,3.8,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = colors.hair;
      ctx.beginPath(); ctx.arc(0,-5.5,2.0,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(-3,3.5,3.2,0,Math.PI*2); ctx.stroke();
      ctx.beginPath(); ctx.arc(3,3.5,3.2,0,Math.PI*2); ctx.stroke();
    } else if(elderly) {
      ctx.fillStyle = colors.hair;
      ctx.beginPath(); ctx.arc(0,-3.5,2.7,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = colors.clothes;
      ctx.beginPath(); ctx.roundRect(-2.5,-1,5,7,1.5); ctx.fill();
      ctx.strokeStyle = colors.cane; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(2,-1); ctx.lineTo(3.2,5); ctx.stroke();
    } else if(child) {
      ctx.scale(0.72, 0.72);
      ctx.fillStyle = colors.hair;
      ctx.beginPath(); ctx.arc(0,-3,2.4,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = colors.clothes;
      ctx.beginPath(); ctx.roundRect(-2.8,-1,5.6,6.5,1.2); ctx.fill();
      ctx.fillStyle = colors.backpack || '#f43f5e';
      ctx.beginPath(); ctx.roundRect(-2.5,0,5.0,4.5,1); ctx.fill();
    } else {
      ctx.fillStyle = colors.hair;
      ctx.beginPath(); ctx.arc(0,-3,2.5,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = colors.clothes;
      ctx.beginPath(); ctx.roundRect(-3,-1,6,7,1.5); ctx.fill();
    }
    ctx.restore();
  }

  function drawStallMarker(slot, occupied){
    if (slot.isZone && slot.pts && slot.pts.length >= 3) {
      ctx.save();
      let strokeColor = 'rgba(22,163,74,.55)';
      if(slot.type === 'disabled') strokeColor = 'rgba(124,58,237,.7)';
      if(slot.type === 'moto') strokeColor = 'rgba(234,179,8,.7)';
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1.2;
      ctx.setLineDash(occupied ? [] : [3,3]);
      ctx.beginPath();
      ctx.moveTo(slot.pts[0][0], slot.pts[0][1]);
      for (let i = 1; i < slot.pts.length; i++) {
        ctx.lineTo(slot.pts[i][0], slot.pts[i][1]);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      if(slot.type === 'disabled'){
        ctx.fillStyle = 'rgba(124,58,237,.10)';
        ctx.fill();
        ctx.fillStyle = 'rgba(124,58,237,.85)';
        ctx.font = '700 10px Inter';
        ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText('♿', slot.x, slot.y);
      } else if(slot.type === 'moto'){
        ctx.fillStyle = 'rgba(234,179,8,.10)';
        ctx.fill();
      } else {
        ctx.fillStyle = 'rgba(22,163,74,.10)';
        ctx.fill();
      }
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.translate(slot.x, slot.y); ctx.rotate(slot.angle);
    const L = slot.type === 'moto' ? 14 : 28;
    const W = slot.type === 'moto' ? 9 : 13;
    let strokeColor = 'rgba(22,163,74,.55)';
    if(slot.type === 'disabled') strokeColor = 'rgba(124,58,237,.7)';
    if(slot.type === 'moto') strokeColor = 'rgba(234,179,8,.7)'; // yellow-500
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 1.2;
    ctx.setLineDash(occupied ? [] : [3,3]);
    ctx.strokeRect(-L/2, -W/2, L, W);
    ctx.setLineDash([]);
    if(slot.type === 'disabled'){
      ctx.fillStyle = 'rgba(124,58,237,.10)';
      ctx.fillRect(-L/2, -W/2, L, W);
      ctx.fillStyle = 'rgba(124,58,237,.85)';
      ctx.font = '700 10px Inter';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText('♿', 0, 0.5);
    } else if(slot.type === 'moto'){
      ctx.fillStyle = 'rgba(234,179,8,.10)';
      ctx.fillRect(-L/2, -W/2, L, W);
    }
    ctx.restore();
  }

  function render(){
    const img = imageCache[tract.key];
    ctx.clearRect(0,0,stage.width,stage.height);
    
    ctx.save();
    const dpr = window.devicePixelRatio || 1;
    ctx.scale(dpr, dpr);
    
    // Apply Camera
    ctx.translate(cam.x, cam.y);
    ctx.scale(cam.zoom, cam.zoom);
    
    ctx.fillStyle = '#0d111d';
    ctx.fillRect(0,0,tract.width,tract.height);
    if(ui.showImage.checked && img.complete){
      ctx.save(); ctx.globalAlpha = 0.85;
      ctx.drawImage(img, 0, 0, tract.width, tract.height);
      ctx.restore();
    }

    if(ui.showHotspots.checked){
      tract.hotspots.forEach(h => {
        const col = HOTSPOT_COLORS[h.type] || HOTSPOT_COLORS.junction;
        const pts = h.area || [[h.x,h.y],[h.x+h.w,h.y],[h.x+h.w,h.y+h.h],[h.x,h.y+h.h]];
        ctx.fillStyle = col.fill;
        ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
        for(let i=1; i<pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = col.stroke; ctx.lineWidth = 1.5;
        ctx.setLineDash([4,4]); ctx.stroke(); ctx.setLineDash([]);
        if(ui.showLabels.checked){
          ctx.fillStyle = col.stroke;
          ctx.font='700 10px Inter, Arial';
          ctx.fillText((h.label||h.name||'').toUpperCase(), pts[0][0]+4, pts[0][1]-4);
        }
      });
    }

    if(ui.showPaths.checked){
      drawPath(tract.carPath, 'rgba(37,99,235,.5)', [], 3);
      if(tract.carPathReverse && tract.carPathReverse.length >= 2){
        drawPath(tract.carPathReverse, 'rgba(236,72,153,.6)', [10,5], 3);
      }
      drawPath(tract.bikePathFwd, 'rgba(234,88,12,.55)', [8,6], 3);
      tract.crossings.forEach(c => {
        const pts = c.path;
        if(pts && pts.length >= 3){
          ctx.fillStyle = 'rgba(15,23,42,.08)';
          ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
          for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i][0], pts[i][1]);
          ctx.closePath(); ctx.fill();
          ctx.strokeStyle = 'rgba(15,23,42,.3)'; ctx.setLineDash([4,4]); ctx.stroke(); ctx.setLineDash([]);
          // Debug walkPath
          if(c.walkPath){
            ctx.strokeStyle = 'rgba(37,99,235,0.6)'; ctx.lineWidth = 1;
            ctx.setLineDash([2,2]);
            ctx.beginPath(); ctx.moveTo(c.walkPath[0][0], c.walkPath[0][1]);
            ctx.lineTo(c.walkPath[1][0], c.walkPath[1][1]);
            ctx.stroke(); ctx.setLineDash([]);
          }
        } else {
          drawPath(pts || [[c.x,c.y1],[c.x,c.y2]], 'rgba(15,23,42,.5)', [4,4], 2);
        }
      });
      tract.driveways.forEach(d => drawPath(d.path, 'rgba(124,58,237,.5)', [4,4], 2));
      (tract.sideStreets||[]).forEach(s => drawPath(s.path, 'rgba(37,99,235,.45)', [4,4], 2));
    }

    if(ui.showStalls.checked){
      const occupiedIds = new Set(entities.parked.map(p => p.id));
      parkingSlots.forEach(slot => drawStallMarker(slot, occupiedIds.has(slot.id)));
    }

    flashes.forEach(f => {
      ctx.save();
      ctx.globalAlpha = Math.min(0.8, f.life);
      const grad = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
      grad.addColorStop(0, f.color);
      grad.addColorStop(1, f.color.replace(/[\d.]+\)$/, '0)'));
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI*2); ctx.fill();
      ctx.restore();
      if(ui.showLabels.checked && f.life > .3){
        ctx.save();
        ctx.font='700 11px Inter, Arial';
        const tw = ctx.measureText(f.label).width;
        ctx.fillStyle = 'rgba(15,23,42,.85)';
        ctx.beginPath(); ctx.roundRect(f.x+8, f.y-18, tw+10, 16, 4); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillText(f.label, f.x+13, f.y-7);
        ctx.restore();
      }
    });

    entities.parked.forEach(p => {
      if(p.state === 'reserved') return;
      if(p.state === 'parked'){
        drawVehicle(p.x, p.y, p.angle, p.vehicleType, {disabled:p.vehicleType==='disabled', customColors: p.customColors});
      } else if((p.state === 'parking' || p.state === 'unparking') && p.maneuver){
        const pos = mPos(p.maneuver);
        drawVehicle(pos.x, pos.y, mHeading(p.maneuver), p.vehicleType, {disabled:p.vehicleType==='disabled', braking:true, customColors: p.customColors});
      }
    });

    entities.cars.forEach(c => {
      ctx.save();
      ctx.globalAlpha = getOpacity(c.t, -0.15, 1.15);
      if(c.state === 'driving' || c.state === 'illegal-stopped'){
        const p = pointOnPath(tract.carPath, c.t);
        if (c.isRoadworks) {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.angle);
          
          ctx.fillStyle = 'rgba(234,179,8,0.15)';
          ctx.beginPath(); ctx.roundRect(-20, -12, 40, 24, 4); ctx.fill();
          ctx.strokeStyle = '#eab308'; ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);
          
          const drawCone = (cx, cy) => {
            ctx.save(); ctx.translate(cx, cy);
            ctx.fillStyle = 'rgba(15,23,42,0.2)';
            ctx.beginPath(); ctx.ellipse(0, 1.5, 3.5, 1.5, 0, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = '#ea580c'; ctx.fillRect(-3, -1, 6, 2);
            ctx.beginPath(); ctx.moveTo(-2, -1); ctx.lineTo(-0.8, -6); ctx.lineTo(0.8, -6); ctx.lineTo(2, -1); ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.beginPath(); ctx.moveTo(-1.4, -3); ctx.lineTo(-1.1, -4.5); ctx.lineTo(1.1, -4.5); ctx.lineTo(1.4, -3); ctx.closePath(); ctx.fill();
            ctx.restore();
          };
          drawCone(-16, -9); drawCone(16, -9); drawCone(-16, 9); drawCone(16, 9);
          
          ctx.fillStyle = 'rgba(15,23,42,0.25)'; ctx.fillRect(-12, -7, 24, 15);
          ctx.fillStyle = '#f8fafc'; ctx.fillRect(-11, -6, 22, 10);
          ctx.fillStyle = '#dc2626';
          for (let sx = -9; sx <= 9; sx += 4.5) {
            ctx.beginPath(); ctx.moveTo(sx - 1.5, -6); ctx.lineTo(sx + 1, 4); ctx.lineTo(sx + 2.5, 4); ctx.lineTo(sx, -6); ctx.closePath(); ctx.fill();
          }
          
          const blink = (Math.floor(performance.now() / 250) % 2) === 0;
          const drawLight = (lx) => {
            ctx.fillStyle = '#334155'; ctx.fillRect(lx - 1, -10, 2, 4);
            ctx.fillStyle = blink ? '#fbbf24' : '#d97706';
            ctx.beginPath(); ctx.arc(lx, -11, 2.5, 0, Math.PI*2); ctx.fill();
            if (blink) {
              ctx.fillStyle = 'rgba(251,191,36,0.3)';
              ctx.beginPath(); ctx.arc(lx, -11, 7, 0, Math.PI*2); ctx.fill();
            }
          };
          drawLight(-7); drawLight(7);
          ctx.restore();
        } else {
          drawVehicle(p.x, p.y, p.angle, c.type, {
            braking: c.braking,
            hazard: c.state==='illegal-stopped' || c.hazard,
            turnSignal: c.turnSignal,
            customColors: c.customColors
          });
        }
      } else if((c.state === 'maneuver-in' || c.state === 'turning-out') && c.maneuver){
        const pos = mPos(c.maneuver);
        drawVehicle(pos.x, pos.y, mHeading(c.maneuver), c.type, {braking:true, turnSignal: c.state === 'turning-out', customColors: c.customColors});
      }
      ctx.restore();
    });

    const renderMergingCar = (e) => {
      ctx.save();
      ctx.globalAlpha = getOpacity(e.t, -0.15, 1.15);
      if(e.state === 'travelling' || e.state === 'yielding'){
        const p = pointOnPath(e.path, e.t);
        drawVehicle(p.x, p.y, p.angle, e.type, {braking: e.state==='yielding' || e.yieldingToBike, customColors: e.customColors});
      } else if(e.state === 'merging'){
        const pos = getMergingCarPos(e);
        drawVehicle(pos.x, pos.y, pos.angle, e.type, {customColors: e.customColors});
      }
      ctx.restore();
    };
    entities.sideCars.forEach(renderMergingCar);

    entities.reverseCars.forEach(c => {
      ctx.save();
      let pos;
      if(c.state === 'entering'){
        const tt = Math.min(1, c.entryDist / Math.max(1, c.entryLen));
        pos = pointOnPath(c.entryPath, tt);
      } else if(c.state === 'reverse'){
        pos = pointOnPath(c.revPath, Math.min(1, Math.max(0, c.t)));
      } else if(c.state === 'exiting'){
        const tt = Math.min(1, c.exitDist / Math.max(1, c.exitLen));
        pos = pointOnPath(c.exitPath, tt);
      }
      if(pos){
        const colors = Object.assign({}, c.customColors || {}, { length: c.length, width: c.width });
        drawVehicle(pos.x, pos.y, pos.angle, c.type, {customColors: colors});
      }
      ctx.restore();
    });

    entities.drivewayCars.forEach(e => {
      ctx.save();
      if(e.state === 'travelling' && e.t < 0.25) {
         ctx.globalAlpha = Math.max(0, e.t / 0.25);
      }
      if(e.state === 'travelling' || e.state === 'yielding'){
        const p = pointOnPath(e.path, Math.min(1, e.t));
        const distToRoad = nearestCarT(p).d;
        if(distToRoad <= 80) {
          drawVehicle(p.x, p.y, p.angle, e.type, {braking: e.state==='yielding' || e.yieldingToBike, customColors: e.customColors});
        }
      } else if(e.state === 'merging'){
        const pos = getMergingCarPos(e);
        drawVehicle(pos.x, pos.y, pos.angle, e.type, {customColors: e.customColors});
      }
      ctx.restore();
    });

    entities.bikes.forEach(b => {
      ctx.save();
      const opProgress = b.dir === 1 ? b.t : (1 - b.t);
      ctx.globalAlpha = getOpacity(opProgress, -0.15, 1.15);
      const pos = getBikePos(b);
      drawBike(pos.x, pos.y, pos.angle, b.dir, b.customColors);
      ctx.restore();
    });
    entities.peds.forEach(p => {
      ctx.save();
      ctx.globalAlpha = getOpacity(p.t, -0.15, 1.15);
      const pos = pointOnPath(p.path, p.t);
      drawPed(pos.x, pos.y, p.wheelchair, p.elderly, p.child, p.customColors);
      ctx.restore();
    });

    if(ui.debugMode && ui.debugMode.checked){
      // Floating labels removed as per request
    }
    ctx.restore();
  }

  function animate(now){
    const dt = Math.min(.05, (now - lastTime) / 1000);
    lastTime = now;
    if(!paused){ updateScene(dt); }
    render();
    requestAnimationFrame(animate);
  }

  function applyProfile(name){
    if(name === 'custom' || !PROFILES[name]) return;
    const p = PROFILES[name];
    ui.carFlow.value = p.car; ui.bikeFlow.value = p.bike; ui.pedFlow.value = p.ped; ui.parkingFlow.value = p.parking;
    syncSliders();
  }

  function syncSliders(){
    ui.carFlowVal.textContent = ui.carFlow.value;
    ui.bikeFlowVal.textContent = ui.bikeFlow.value;
    ui.pedFlowVal.textContent = ui.pedFlow.value;
    ui.parkingFlowVal.textContent = ui.parkingFlow.value;
    ui.parkingFillVal.textContent = ui.parkingFill.value;
  }
  ['input','change'].forEach(evt => [ui.carFlow,ui.bikeFlow,ui.pedFlow,ui.parkingFlow,ui.parkingFill].forEach(el => el.addEventListener(evt, () => {
    syncSliders();
    if(ui.profileSelect.value !== 'custom') ui.profileSelect.value = 'custom';
  })));
  syncSliders();

  ui.profileSelect.addEventListener('change', () => applyProfile(ui.profileSelect.value));
  ui.tractSelect.addEventListener('change', () => { renderTexts(); resetScene(true); });
  ui.scenarioSelect.addEventListener('change', () => {
    const sc = ui.scenarioSelect.value;
    if (sc === 'standard') {
      ui.carFlow.value = 15; ui.bikeFlow.value = 6; ui.pedFlow.value = 8; ui.parkingFlow.value = 30; ui.parkingFill.value = 60;
    } else if (sc === 'school_peak') {
      ui.carFlow.value = 40; ui.bikeFlow.value = 12; ui.pedFlow.value = 35; ui.parkingFlow.value = 65; ui.parkingFill.value = 80;
    } else if (sc === 'delivery_block') {
      ui.carFlow.value = 20; ui.bikeFlow.value = 6; ui.pedFlow.value = 12; ui.parkingFlow.value = 40; ui.parkingFill.value = 70;
    } else if (sc === 'vulnerable_users') {
      ui.carFlow.value = 14; ui.bikeFlow.value = 18; ui.pedFlow.value = 25; ui.parkingFlow.value = 25; ui.parkingFill.value = 65;
    } else if (sc === 'driveway_conflict') {
      ui.carFlow.value = 18; ui.bikeFlow.value = 10; ui.pedFlow.value = 14; ui.parkingFlow.value = 45; ui.parkingFill.value = 60;
    } else if (sc === 'roadworks') {
      ui.carFlow.value = 18; ui.bikeFlow.value = 8; ui.pedFlow.value = 12; ui.parkingFlow.value = 20; ui.parkingFill.value = 60;
    } else if (sc === 'dropoff') {
      ui.carFlow.value = 22; ui.bikeFlow.value = 8; ui.pedFlow.value = 15; ui.parkingFlow.value = 35; ui.parkingFill.value = 90;
    } else if (sc === 'ambulance') {
      ui.carFlow.value = 32; ui.bikeFlow.value = 10; ui.pedFlow.value = 18; ui.parkingFlow.value = 40; ui.parkingFill.value = 65;
    }
    syncSliders();
    if(ui.profileSelect.value !== 'custom') ui.profileSelect.value = 'custom';
    
    ui.scenarioChip.textContent = ui.scenarioSelect.options[ui.scenarioSelect.selectedIndex].text;
    
    // Synchronize active class on visual scenario cards
    if (ui.scenarioGrid) {
      ui.scenarioGrid.querySelectorAll('.scenario-card').forEach(card => {
        if (card.getAttribute('data-value') === sc) {
          card.classList.add('active');
        } else {
          card.classList.remove('active');
        }
      });
    }
    
    resetScene(false);
  });
  function updatePauseUI() {
    ui.pauseBtn.textContent = paused ? '▶ Riprendi' : '⏸ Pausa';
    if (ui.badgeSimulationStatus) {
      if (paused) {
        ui.badgeSimulationStatus.className = 'badge badge-warning';
        ui.badgeSimulationStatus.innerHTML = '<span class="dot"></span> SIMULAZIONE IN PAUSA';
      } else {
        ui.badgeSimulationStatus.className = 'badge badge-success';
        ui.badgeSimulationStatus.innerHTML = '<span class="dot"></span> SIMULAZIONE ATTIVA';
      }
    }
  }

  ui.pauseBtn.addEventListener('click', () => {
    paused = !paused;
    updatePauseUI();
  });

  ui.resetBtn.addEventListener('click', () => {
    resetScene(true);
    // Ensure badges/stats reset correctly
    updateStats();
  });

  // Onboarding Modal Handlers
  if (ui.openOnboardingBtn) {
    ui.openOnboardingBtn.addEventListener('click', () => {
      if (ui.firstVisitModal) ui.firstVisitModal.style.display = 'flex';
    });
  }

  if (ui.closeModalBtn) {
    ui.closeModalBtn.addEventListener('click', () => {
      if (ui.firstVisitModal) ui.firstVisitModal.style.display = 'none';
      localStorage.setItem('viale_onboarding_shown', 'true');
    });
  }

  if (ui.closeModalCrossBtn) {
    ui.closeModalCrossBtn.addEventListener('click', () => {
      if (ui.firstVisitModal) ui.firstVisitModal.style.display = 'none';
      localStorage.setItem('viale_onboarding_shown', 'true');
    });
  }

  const modalBackdrop = document.querySelector('.modal-backdrop');
  if (modalBackdrop) {
    modalBackdrop.addEventListener('click', () => {
      if (ui.firstVisitModal) ui.firstVisitModal.style.display = 'none';
      localStorage.setItem('viale_onboarding_shown', 'true');
    });
  }

  // Check first visit
  const hasShownOnboarding = localStorage.getItem('viale_onboarding_shown');
  if (!hasShownOnboarding) {
    setTimeout(() => {
      if (ui.firstVisitModal) ui.firstVisitModal.style.display = 'flex';
    }, 600);
  }

  // Initialize status badge
  updatePauseUI();

  document.getElementById('fullscreenBtn').addEventListener('click', () => {
    const wrap = document.querySelector('.stageWrap');
    if (!document.fullscreenElement) {
      wrap.requestFullscreen().catch(e => console.error(e));
    } else {
      document.exitFullscreen();
    }
  });

  const wrap = document.querySelector('.stageWrap');
  wrap.addEventListener('mousedown', e => {
    if(e.button === 0){
      isPanning = true;
      lastPanPos = { x: e.clientX, y: e.clientY };
    }
  });
  window.addEventListener('mousemove', e => {
    if(!isPanning) return;
    const dx = e.clientX - lastPanPos.x;
    const dy = e.clientY - lastPanPos.y;
    cam.x += dx;
    cam.y += dy;
    lastPanPos = { x: e.clientX, y: e.clientY };
  });
  window.addEventListener('mouseup', () => isPanning = false);
  wrap.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = wrap.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    
    const wx = (mx - cam.x) / cam.zoom;
    const wy = (my - cam.y) / cam.zoom;
    
    const delta = e.deltaY < 0 ? 1.1 : 0.9;
    cam.zoom = Math.max(0.1, Math.min(10, cam.zoom * delta));
    
    cam.x = mx - wx * cam.zoom;
    cam.y = my - wy * cam.zoom;
  }, {passive:false});
  
  document.addEventListener('fullscreenchange', () => {
    setTimeout(() => {
      updateCanvasSize();
      resetCamera();
    }, 150);
  });
  window.addEventListener('storage', async (e) => {
    if (e.key && e.key.startsWith('viale_tract_')) {
      await loadCalibrationData();
      normalizeBikePaths();
      renderTexts();
      resetScene(false);
    }
  });

  const scenarioIcons = {
    standard: '🟢',
    school_peak: '🏫',
    delivery_block: '🚚',
    vulnerable_users: '🚶',
    driveway_conflict: '🚗',
    roadworks: '⚠️',
    dropoff: '🧓',
    ambulance: '🚑'
  };
  const scenarioShortDescs = {
    standard: 'Flusso diurno regolare e ben bilanciato.',
    school_peak: 'Ingresso/uscita scuole, traffico intenso.',
    delivery_block: 'Sosta in seconda fila e deviazioni.',
    vulnerable_users: 'Utenza debole, pendenze e bici a rilento.',
    driveway_conflict: 'Immissioni e precedenze dai passi carrabili.',
    roadworks: 'Cantiere mobile e senso alternato di fatto.',
    dropoff: 'Fermata improvvisa cortesia passeggero.',
    ambulance: 'Mezzo di soccorso prioritario in emergenza.'
  };

  function buildScenarioCards() {
    if (!ui.scenarioGrid || !ui.scenarioSelect) return;
    ui.scenarioGrid.innerHTML = '';
    
    const options = Array.from(ui.scenarioSelect.options);
    options.forEach(opt => {
      const val = opt.value;
      const label = opt.textContent;
      const icon = scenarioIcons[val] || '⚙️';
      const desc = scenarioShortDescs[val] || '';
      
      const card = document.createElement('div');
      card.className = `scenario-card${val === ui.scenarioSelect.value ? ' active' : ''}`;
      card.setAttribute('data-value', val);
      card.innerHTML = `
        <div class="sc-icon">${icon}</div>
        <div class="sc-info">
          <div class="sc-title">${label}</div>
          <div class="sc-desc">${desc}</div>
        </div>
      `;
      card.addEventListener('click', () => {
        ui.scenarioGrid.querySelectorAll('.scenario-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        ui.scenarioSelect.value = val;
        ui.scenarioSelect.dispatchEvent(new Event('change'));
      });
      ui.scenarioGrid.appendChild(card);
    });
  }

  buildScenarioCards();

  // Sidebar show/hide toggle with layout resize hook
  const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
  const layout = document.querySelector('.layout');
  if (sidebarToggleBtn && layout) {
    sidebarToggleBtn.addEventListener('click', () => {
      layout.classList.toggle('sidebar-hidden');
      if (layout.classList.contains('sidebar-hidden')) {
        sidebarToggleBtn.innerHTML = '☰';
        sidebarToggleBtn.title = "Mostra controlli";
      } else {
        sidebarToggleBtn.innerHTML = '✕';
        sidebarToggleBtn.title = "Nascondi controlli";
      }
      
      // Dynamic canvas sizing during sliding animation for a premium liquid resize effect
      let count = 0;
      const interval = setInterval(() => {
        updateCanvasSize();
        count++;
        if (count > 25) clearInterval(interval);
      }, 16);
    });

    layout.addEventListener('transitionend', (e) => {
      if (e.propertyName === 'grid-template-columns' || e.propertyName === 'gap') {
        updateCanvasSize();
      }
    });
  }

  // Collapsible sidebar headers click binding
  const collapsibleHeaders = document.querySelectorAll('.collapsible-header');
  collapsibleHeaders.forEach(hdr => {
    hdr.addEventListener('click', () => {
      hdr.classList.toggle('collapsed');
      const content = hdr.nextElementSibling;
      if (content && content.classList.contains('collapsible-content')) {
        content.classList.toggle('collapsed');
      }
    });
  });

  ui.tractSelect.value = 'D';
  renderTexts(); syncSliders(); resetScene(true);
  pushLog('start', 'Simulatore avviato. Veicoli misti, distanza di sicurezza, manovre di parcheggio reali.');
  requestAnimationFrame(animate);
})();
