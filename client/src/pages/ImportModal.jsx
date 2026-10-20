import { useState } from 'react';
import { api, number } from '../api.js';
import { Modal, useApp, useToast } from '../components/ui.jsx';
import { parseCsv, KNOWN_COLUMNS, ALIASES } from '../../../server/csv.js';

const find = (row, key) => {
  const lower = Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toLowerCase().trim(), v]));
  const n = ALIASES[key].find((a) => lower[a] !== undefined && String(lower[a]).trim() !== '');
  return n ? lower[n] : '';
};

export default function ImportModal({ onClose, onDone }) {
  const { activeTeam, reloadMeta } = useApp();
  const toast = useToast();
  const [file, setFile] = useState(null);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [onlyWithoutWeb, setOnlyWithoutWeb] = useState(true);
  const [skipClosed, setSkipClosed] = useState(true);
  const [owner, setOwner] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const pick = async (e) => {
    const f = e.target.files?.[0];
    setError('');
    setRows(null);
    setFile(f || null);
    if (!f) return;
    const name = f.name.toLowerCase();
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      setError('Este es un archivo de Excel. En Outscraper descarga el resultado en formato CSV, o en Excel usa Archivo → Guardar como → "CSV UTF-8".');
      return;
    }
    try {
      const text = await f.text();
      const data = name.endsWith('.json') ? JSON.parse(text) : parseCsv(text);
      if (!Array.isArray(data) || !data.length) throw new Error('El archivo está vacío.');
      if (!data.some((r) => find(r, 'name'))) throw new Error('No encontramos la columna con el nombre de la empresa. Debe llamarse "name", "nombre", "negocio" o "empresa".');
      // Solo se envían las columnas que el CRM usa
      const slim = data.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => KNOWN_COLUMNS.includes(k.toLowerCase().trim()))));
      setRows(slim);
    } catch (err) {
      setError(err.message.startsWith('Unexpected') ? 'No se pudo leer el archivo. ¿Es un CSV o JSON válido?' : err.message);
    }
  };

  const run = async () => {
    setBusy(true);
    try {
      const r = await api('/import', { method: 'POST', body: { rows, options: { onlyWithoutWeb, skipClosed, owner_id: owner || null } } });
      setResult(r);
      reloadMeta();
      if (r.created) toast(`${r.created} empresas importadas`);
    } catch (err) { setError(err.message); }
    setBusy(false);
  };

  if (result) {
    const lines = [
      [result.created, 'empresas nuevas cargadas como "Prospecto"', 'ok'],
      [result.existing, 'ya estaban en el CRM (no se duplicaron)'],
      [result.withWeb, 'tienen página web propia (omitidas)'],
      [result.closed, 'figuran cerradas en Google (omitidas)'],
      [result.invalid, 'filas sin nombre (omitidas)'],
    ].filter(([n]) => n > 0);
    return (
      <Modal title="Importación terminada" onClose={() => { onClose(); onDone?.(); }}
        footer={<button type="button" className="btn btn-primary" onClick={() => { onClose(); onDone?.(); }}>Ver empresas</button>}>
        <ul className="import-result">
          {lines.map(([n, label, kind]) => <li key={label} className={kind === 'ok' ? 'is-ok' : ''}><strong>{number(n)}</strong> {label}</li>)}
        </ul>
        {!result.created && <p className="muted">No se cargó ninguna empresa nueva.</p>}
      </Modal>
    );
  }

  const preview = rows?.slice(0, 5) || [];
  return (
    <Modal title="Importar empresas" onClose={onClose} wide
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button type="button" className="btn btn-primary" disabled={!rows || busy} onClick={run}>
          {busy ? 'Importando…' : rows ? `Importar ${number(rows.length)} filas` : 'Importar'}
        </button>
      </>}>
      <div className="stack">
        <p className="muted">
          Sube el archivo <strong>CSV</strong> que descargas de Outscraper (o cualquier lista con columnas como nombre, teléfono, dirección, ciudad, web).
          Las empresas que ya están en el CRM no se duplican.
        </p>
        <label className="file-drop">
          <input id="import-file" type="file" accept=".csv,.json,.xlsx,.xls,text/csv,application/json" onChange={pick} />
          <span className="btn btn-ghost">Elegir archivo</span>
          <span className="muted">{file ? file.name : 'Ningún archivo elegido'}</span>
        </label>
        {error && <div className="alert">{error}</div>}

        {rows && (
          <>
            <div className="table-wrap">
              <table className="table table-compact">
                <thead><tr><th>Nombre</th><th>Teléfono</th><th className="hide-sm">Ciudad</th><th className="hide-sm">Web</th></tr></thead>
                <tbody>
                  {preview.map((r, i) => (
                    <tr key={i}>
                      <td>{find(r, 'name') || <span className="muted">—</span>}</td>
                      <td className="num">{find(r, 'telefono') || <span className="muted">—</span>}</td>
                      <td className="hide-sm">{find(r, 'ciudad') || '—'}</td>
                      <td className="hide-sm cell-clip">{find(r, 'web') || <span className="muted">Sin web</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted small">{rows.length > 5 ? `Primeras 5 de ${number(rows.length)} filas.` : `${rows.length} filas.`}</p>

            <div className="import-options">
              <label className="check"><input id="imp-noweb" type="checkbox" checked={onlyWithoutWeb} onChange={(e) => setOnlyWithoutWeb(e.target.checked)} /> Solo empresas sin página web propia (las que solo tienen Facebook o Instagram sí entran)</label>
              <label className="check"><input id="imp-closed" type="checkbox" checked={skipClosed} onChange={(e) => setSkipClosed(e.target.checked)} /> Omitir negocios cerrados</label>
              <label className="inline-field">
                <span>Asignar a</span>
                <select id="imp-owner" value={owner} onChange={(e) => setOwner(e.target.value)}>
                  <option value="">Sin responsable</option>
                  {activeTeam.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
            </div>
            <p className="muted small">La prioridad (A, B o C) se calcula sola según si tienen celular, cuántas reseñas y qué calificación.</p>
          </>
        )}
      </div>
    </Modal>
  );
}
