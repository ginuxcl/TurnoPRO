import { useEffect, useRef, useState } from 'react';
import { Topbar } from '../components/Layout.jsx';
import { post } from '../api.js';
import { Spinner } from '../ui.jsx';
import { useAuth } from '../AuthContext.jsx';

const SUGGESTIONS_MGR = [
  '¿Quién está en turno ahora?',
  '¿Quién trabaja mañana?',
  '¿Quién está libre el viernes?',
  'Turnos abiertos esta semana',
  'Coste de esta semana',
  'Ausencias pendientes',
];
const SUGGESTIONS_EMP = [
  '¿Quién trabaja mañana?',
  'Mis horas esta semana',
  'Turnos abiertos esta semana',
  'Mis solicitudes',
];

export default function Assistant() {
  const { user } = useAuth();
  const [messages, setMessages] = useState([
    { who: 'bot', text: '¡Hola! Soy el asistente de TurnoPro. Pregúntame sobre el cuadrante, turnos abiertos, horas o solicitudes.' },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const ask = async (text) => {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    setInput('');
    setMessages((m) => [...m, { who: 'me', text: q }]);
    setBusy(true);
    try {
      const r = await post('/assistant/query', { question: q });
      setMessages((m) => [...m, { who: 'bot', text: r.answer }]);
    } catch (e) {
      setMessages((m) => [...m, { who: 'bot', text: `Vaya, no pude resolverlo: ${e.message}` }]);
    }
    setBusy(false);
  };

  const suggestions = user.role === 'employee' ? SUGGESTIONS_EMP : SUGGESTIONS_MGR;

  return (
    <>
      <Topbar title="Asistente" />
      <div className="content" style={{ maxWidth: 760, display: 'flex', flexDirection: 'column' }}>
        <div className="card card-pad chat-box">
          {messages.map((m, i) => (
            <div key={i} className={`chat-msg ${m.who}`}>
              <div className="bubble">{m.text}</div>
            </div>
          ))}
          {busy && (
            <div className="chat-msg bot"><div className="bubble"><Spinner /></div></div>
          )}
          <div ref={endRef} />
        </div>

        <div className="chat-suggestions">
          {suggestions.map((s) => (
            <button key={s} className="btn btn-soft btn-sm" onClick={() => ask(s)} disabled={busy}>{s}</button>
          ))}
        </div>

        <form
          className="chat-input"
          onSubmit={(e) => { e.preventDefault(); ask(); }}
        >
          <input
            className="input"
            value={input}
            placeholder="Escribe tu pregunta… p. ej. ¿quién trabaja mañana?"
            onChange={(e) => setInput(e.target.value)}
            maxLength={300}
          />
          <button className="btn btn-primary" disabled={busy || !input.trim()}>Enviar</button>
        </form>
      </div>
    </>
  );
}
