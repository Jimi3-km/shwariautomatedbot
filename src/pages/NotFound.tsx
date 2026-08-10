import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Button, EmptyState } from '../components/ui';

export function NotFound() {
  const navigate = useNavigate();
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <EmptyState
        icon={<Compass size={26} />}
        title="Page not found"
        body="That page does not exist, or you may not have access to it."
        action={<Button variant="solid" onClick={() => navigate('/')}>Back to overview</Button>}
      />
    </div>
  );
}
