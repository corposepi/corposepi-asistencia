// Proceso automático de ausencias — corre en GitHub Actions (nube), no depende de tener
// el panel abierto en un navegador. Marca "Ausente" (-75 FNX) a los estudiantes activos
// que no registraron entrada hoy, PERO solo si hoy es un día hábil real:
// no fines de semana, no feriados, no semanas inactivas (según Plataforma Aprende).

const DB = 'https://corposepi-carnets-default-rtdb.firebaseio.com';

async function getJSON(path) {
  const res = await fetch(`${DB}/${path}.json`);
  if (!res.ok) throw new Error(`Error leyendo ${path}: ${res.status}`);
  return res.json();
}
async function putJSON(path, data) {
  const res = await fetch(`${DB}/${path}.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Error escribiendo ${path}: ${res.status}`);
  return res.json();
}

function lunesDeSemana(fechaISO) {
  const d = new Date(fechaISO + 'T12:00:00Z');
  const dow = d.getUTCDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

async function verificarDiaHabil(hoy, dow) {
  if (dow === 0) return { habil: false, motivo: 'Hoy es domingo, no hay clases.' };
  if (dow === 6) return { habil: false, motivo: 'Hoy es sábado, no hay clases.' };
  const feriadosObj = (await getJSON('aprende_feriados')) || {};
  const feriados = Object.values(feriadosObj);
  const fer = feriados.find((f) => f && f.fecha === hoy);
  if (fer) return { habil: false, motivo: `Hoy es feriado: ${fer.nombre || 'sin clases'}.` };
  const semanasActivas = (await getJSON('aprende_semanas')) || {};
  const lunes = lunesDeSemana(hoy);
  if (semanasActivas[lunes] === false) {
    return { habil: false, motivo: 'Esta semana no hay clases (receso / vacaciones).' };
  }
  return { habil: true };
}

async function main() {
  // Corre a las 19:00 UTC = 2:00pm hora Colombia (UTC-5, sin horario de verano),
  // así que la fecha/hora UTC del runner coincide con la fecha en Colombia en ese momento.
  const ahora = new Date();
  const hoy = ahora.toISOString().slice(0, 10);
  const dow = ahora.getUTCDay();

  console.log(`Verificando día hábil para ${hoy}...`);
  const chequeo = await verificarDiaHabil(hoy, dow);
  if (!chequeo.habil) {
    console.log(`📴 ${chequeo.motivo} No se procesan ausencias.`);
    return;
  }
  console.log('✅ Hoy es día hábil. Procesando ausencias...');

  const students = (await getJSON('corposepi/students')) || [];
  const asistenciaHoy = (await getJSON(`asistencia/${hoy}`)) || {};
  const asistidos = new Set(Object.values(asistenciaHoy).map((r) => r && r.id).filter(Boolean));

  let count = 0;
  for (let i = 0; i < students.length; i++) {
    const s = students[i];
    if (!s || s.status !== 'active') continue;
    if (asistidos.has(s.id)) continue;

    const fnxActual = parseFloat(s.fnx || 0);
    const fnxNuevo = Math.max(0, fnxActual - 75);
    await putJSON(`corposepi/students/${i}/fnx`, fnxNuevo.toFixed(2));

    const safeId = s.id.replace(/[^a-z0-9]/gi, '-');
    await putJSON(`asistencia/${hoy}/${safeId}`, {
      id: s.id,
      tipo: 'student',
      nombre: `${s.nombres} ${s.apellidos}`,
      fecha: hoy,
      hora: '14:00',
      timestamp: ahora.toISOString(),
      estado: 'A',
      penalidad_fnx: 75,
      fnx_antes: fnxActual,
      fnx_despues: fnxNuevo,
      etiqueta: '❌ Ausente (-75 FNX)',
      cel: s.cel || '',
      lat: '', lng: '', acc: '',
      origen: 'auto-2pm-github-actions',
    });

    console.log(`❌ Ausente: ${s.nombres} ${s.apellidos} (${s.id}) — FNX ${fnxActual} → ${fnxNuevo}`);
    count++;
  }

  console.log(count > 0 ? `✅ ${count} ausencias registradas.` : '✅ Todos los estudiantes activos registraron asistencia hoy.');
}

main().catch((e) => {
  console.error('Error en el proceso de ausencias:', e);
  process.exit(1);
});
