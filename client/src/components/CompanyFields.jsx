import { useApp } from './ui.jsx';

export const emptyCompany = {
  name: '', rubro: '', ciudad: '', direccion: '', telefono: '', email: '', web: '', presencia: '',
  contacto_nombre: '', contacto_cargo: '', maps_url: '', rating: '', reviews: '', notas: '',
};

const PRESENCIA = ['Nada', 'Solo Facebook', 'Solo Instagram', 'Solo Linktree', 'Solo app de delivery/link', 'Web propia'];

// Campos de datos de la empresa, compartidos por "Nueva empresa" y la ficha.
export default function CompanyFields({ value, onChange, idPrefix = 'co' }) {
  const { meta } = useApp();
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  const input = (k, label, props = {}) => (
    <label className="field">
      <span className="field-label">{label}</span>
      <input id={`${idPrefix}-${k}`} value={value[k] ?? ''} onChange={set(k)} {...props} />
    </label>
  );
  return (
    <div className="grid-form">
      {input('name', 'Nombre de la empresa *', { required: true, maxLength: 200 })}
      {input('rubro', 'Rubro', { list: `${idPrefix}-rubros` })}
      <datalist id={`${idPrefix}-rubros`}>{meta.rubros.map((r) => <option key={r} value={r} />)}</datalist>
      {input('ciudad', 'Ciudad', { list: `${idPrefix}-ciudades` })}
      <datalist id={`${idPrefix}-ciudades`}>{meta.ciudades.map((r) => <option key={r} value={r} />)}</datalist>
      {input('direccion', 'Dirección')}
      {input('telefono', 'Teléfono', { type: 'tel', placeholder: '+595 981 123456' })}
      {input('email', 'Email', { type: 'email' })}
      {input('contacto_nombre', 'Persona de contacto')}
      {input('contacto_cargo', 'Cargo del contacto', { placeholder: 'Dueño, gerente…' })}
      <label className="field">
        <span className="field-label">Presencia online</span>
        <select id={`${idPrefix}-presencia`} value={value.presencia ?? ''} onChange={set('presencia')}>
          <option value="">—</option>
          {PRESENCIA.map((p) => <option key={p}>{p}</option>)}
        </select>
      </label>
      {input('web', 'Web o red social', { placeholder: 'https://…' })}
      {input('maps_url', 'Link de Google Maps', { type: 'url' })}
      <div className="field-pair">
        {input('rating', 'Calificación', { type: 'number', min: 0, max: 5, step: 0.1 })}
        {input('reviews', 'Reseñas', { type: 'number', min: 0 })}
      </div>
      <label className="field field-full">
        <span className="field-label">Notas sobre la empresa</span>
        <textarea id={`${idPrefix}-notas`} rows={3} value={value.notas ?? ''} onChange={set('notas')} placeholder="Qué venden, horarios, quién decide, etc." />
      </label>
    </div>
  );
}
