import { Filter, RelayManager, RelayScore, Scope } from "..";

export class RelayManagerImpl implements RelayManager {

  constructor(scope: Scope) {

  }

  getFilterRelays(filter: Filter): Promise<RelayScore[]> {
    
  }
  getPubkeyReadRelays(pubkey: string): Promise<RelayScore[]> {
    
  }
  getPubkeyWriteRelays(pubkey: string): Promise<RelayScore[]> {
    
  }
}