import React from 'react';
import { Link } from 'react-router-dom';
import { Check, Circle, ArrowRight } from 'lucide-react';
import type { Onboarding } from '../types';
import { Button } from './ui';

/**
 * Setup progress for a new business. Every step's completion is computed
 * server-side from real tenant state, so the checklist cannot claim something
 * is done when it is not.
 */
export function OnboardingChecklist({ data }: { data: Onboarding }) {
  if (data.dismissed) return null;
  const next = data.steps.find((s) => !s.done);
  const pct = Math.round((data.completed / data.total) * 100);

  return (
    <div className="card p-4">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: 14.5, fontWeight: 600 }}>Set up your business</h2>
          <p style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 2 }}>
            {data.completed} of {data.total} steps complete
          </p>
        </div>
        {next && (
          <Link to={next.href}>
            <Button size="sm" variant="solid" icon={<ArrowRight size={13} />}>Continue</Button>
          </Link>
        )}
      </div>

      <div style={{ height: 4, background: 'var(--surface-2)', borderRadius: 999, overflow: 'hidden', marginBottom: 14 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)', transition: 'width .3s ease' }} />
      </div>

      <ul style={{ display: 'grid', gap: 2 }}>
        {data.steps.map((step) => (
          <li key={step.id}>
            <Link
              to={step.href}
              style={{
                display: 'flex', alignItems: 'center', gap: 9, padding: '6px 6px',
                borderRadius: 'var(--radius-sm)', fontSize: 13,
                color: step.done ? 'var(--text-3)' : 'var(--text)',
              }}
            >
              {step.done
                ? <Check size={14} style={{ color: 'var(--success)', flexShrink: 0 }} />
                : <Circle size={14} style={{ color: 'var(--text-4)', flexShrink: 0 }} />}
              <span style={{ textDecoration: step.done ? 'line-through' : 'none' }}>{step.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
