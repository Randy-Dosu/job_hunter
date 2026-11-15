import { Link } from 'react-router-dom';
import { Button, Card, EmptyState } from '../components/ui.js';

export default function NotFoundPage() {
  return (
    <Card>
      <EmptyState
        title="Page not found"
        description="That page does not exist, or it belongs to a different account."
        action={
          <Link to="/">
            <Button>Back to dashboard</Button>
          </Link>
        }
      />
    </Card>
  );
}
