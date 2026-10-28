import React, { useState } from 'react';
import { Reveal } from './Reveal';

export const EditorialFooter: React.FC = () => {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  return (
    <footer className="ed-footer">
      <div className="ed-footer-grid">
        <div className="ed-footer-left">
          <Reveal>
            <p className="ed-label" style={{ color: '#ccd5ae' }}>Harvest Dispatch</p>
            <h2 className="display" style={{ color: '#ccd5ae', fontSize: 'clamp(2.5rem,6vw,5rem)', margin: '16px 0' }}>
              GET FRESH<br />LOTS FIRST.
            </h2>
            <form
              onSubmit={(e) => { e.preventDefault(); if (email) setDone(true); }}
              style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', marginTop: '12px' }}
            >
              <input
                className="ed-input"
                placeholder="EMAIL ADDRESS"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <button className="ed-cart" type="submit">{done ? 'IN' : 'JOIN'}</button>
            </form>
            {done && <p className="ed-meta" style={{ color: '#ccd5ae', marginTop: '12px' }}>Subscribed — welcome to the chain.</p>}
          </Reveal>
        </div>
        <div className="ed-footer-right">
          <div>
            <p className="ed-label" style={{ color: '#ccd5ae', marginBottom: '16px' }}>Market</p>
            <a className="ed-flink" href="#section-marketplace">Catalog</a>
            <a className="ed-flink" href="#section-farmer">Farmer Portal</a>
            <a className="ed-flink" href="#section-oracle">AI Oracle</a>
          </div>
          <div>
            <p className="ed-label" style={{ color: '#ccd5ae', marginBottom: '16px' }}>Protocol</p>
            <a className="ed-flink" href="#section-juror">Dispute DAO</a>
            <a className="ed-flink" href="#section-admin">Governance</a>
            <a className="ed-flink" href="http://localhost:5000/api/contracts">Contracts</a>
          </div>
        </div>
      </div>
      <div style={{ maxWidth: '1280px', margin: '48px auto 0', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <span className="ed-legal">© 2026 AgriChain — Polygon L2</span>
        <span className="ed-legal">Escrow · SBT · Merkle · DAO</span>
      </div>
    </footer>
  );
};
