import { Injectable } from '@angular/core';
import { collection, addDoc, query, orderBy, limit, getDocs, where } from 'firebase/firestore';
import { db } from '../firebase.config';
import { LeaderboardService, LeaderboardEntry } from './leaderboard.service';

export type { LeaderboardEntry };

export interface ActionEvent {
  timestamp: number;
  type: 'damage' | 'scramble' | 'healing';
  amount?: number;
  isAssist?: boolean;
}

export interface LevelRecording {
  sessionId: string;
  target: number;
  difficulty: 'easy' | 'normal' | 'hard';
  playerName?: string;
  startTime: number;
  endTime: number;
  actions: ActionEvent[];
  totalDamageDealt: number;
  enemyHealthAtStart: number;
  playerHealthAtStart: number;
}

@Injectable({ providedIn: 'root' })
export class NumberCrunchService {
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
      await addDoc(collection(db, 'NumberCrunchLeaderboard'), entryWithIP);
    } catch (error) {
      console.error('Error adding entry:', error);
      // Don't throw - let the game continue even if leaderboard fails
    }
  }

  async getTopEntries(count: number = 10): Promise<LeaderboardEntry[]> {
    try {
      const q = query(collection(db, 'NumberCrunchLeaderboard'), orderBy('score', 'desc'), limit(count));
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

  // Replay functionality
  async saveReplay(recording: LevelRecording): Promise<void> {
    try {
      // Clean up actions array to remove undefined values
      const cleanActions = recording.actions.map(action => ({
        timestamp: action.timestamp,
        type: action.type,
        ...(action.amount !== undefined && { amount: action.amount }),
        ...(action.isAssist !== undefined && { isAssist: action.isAssist })
      }));

      // Create a clean object without undefined values
      const cleanRecording = {
        sessionId: recording.sessionId,
        target: recording.target,
        difficulty: recording.difficulty,
        startTime: recording.startTime,
        endTime: recording.endTime,
        actions: cleanActions,
        totalDamageDealt: recording.totalDamageDealt,
        enemyHealthAtStart: recording.enemyHealthAtStart,
        playerHealthAtStart: recording.playerHealthAtStart,
        ...(recording.playerName && { playerName: recording.playerName })
      };

      console.log('Saving replay:', cleanRecording);
      await addDoc(collection(db, 'NumberCrunchReplays'), cleanRecording);
      console.log('Replay saved successfully');
    } catch (error) {
      console.error('Error saving replay:', error);
      // Don't throw - let the game continue even if replay save fails
    }
  }

  async getReplaysByTarget(target: number, count: number = 10): Promise<LevelRecording[]> {
    try {
      const q = query(
        collection(db, 'NumberCrunchReplays'),
        where('target', '==', target),
        orderBy('sessionId'), // Use sessionId for unique ordering
        limit(count)
      );
      const querySnapshot = await getDocs(q);
      const replays = querySnapshot.docs.map(doc => doc.data() as LevelRecording);
      
      // Sort by endTime after fetching to get fastest times first
      return replays.sort((a, b) => a.endTime - b.endTime);
    } catch (error) {
      console.warn('Replays unavailable:', error);
      return [];
    }
  }
}