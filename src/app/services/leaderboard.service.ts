import { Injectable } from '@angular/core';
import { collection, addDoc, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../firebase.config';

export interface LeaderboardEntry {
  name: string;
  score: number;
  difficulty: string;
  level: number;
  date: Date;
  ipAddress?: string;
}

@Injectable({ providedIn: 'root' })
export class LeaderboardService {
  private async getIPAddress(): Promise<string | undefined> {
    try {
      const response = await fetch('https://api.ipify.org?format=json');
      const data = await response.json();
      return data.ip;
    } catch (error) {
      console.error('Error fetching IP address:', error);
      return undefined;
    }
  }

  async addEntry(entry: Omit<LeaderboardEntry, 'ipAddress'>): Promise<void> {
    try {
      const ipAddress = await this.getIPAddress();
      const entryWithIP = { ...entry, ipAddress };
      await addDoc(collection(db, 'leaderboard'), entryWithIP);
    } catch (error) {
      console.error('Error adding entry:', error);
      // Don't throw - let the game continue even if leaderboard fails
    }
  }

  async getTopEntries(count: number = 10): Promise<LeaderboardEntry[]> {
    try {
      const q = query(collection(db, 'leaderboard'), orderBy('score', 'desc'), limit(count));
      const querySnapshot = await getDocs(q);
      return querySnapshot.docs.map(doc => doc.data() as LeaderboardEntry);
    } catch (error) {
      console.warn('Leaderboard unavailable (possibly blocked by ad blocker):', error);
      return [];
    }
  }

  // Check if Firestore is accessible
  async isAvailable(): Promise<boolean> {
    try {
      await this.getTopEntries(1);
      return true;
    } catch (error) {
      return false;
    }
  }
}