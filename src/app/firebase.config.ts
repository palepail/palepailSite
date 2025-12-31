import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

// For CI/CD environments, create src/environments/environment.ts with proper Firebase config
// This import will fail if the file doesn't exist - CI/CD systems must create it
import { environment } from '../environments/environment';

const app = initializeApp(environment.firebase);
export const db = getFirestore(app);