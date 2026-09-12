/** CLI entry point. `app.ts` holds the routes so tests can `app.listen(0)` themselves. */
import { app } from './app';

const PORT = 4400;
app.listen(PORT, () => {
  console.log(`fixture listening on http://localhost:${PORT}`);
});
