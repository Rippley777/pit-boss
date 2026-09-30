use crate::models::*;
use rusqlite::{params, Connection};
use std::{path::Path, sync::Mutex};
pub struct Storage(pub Mutex<Connection>);
impl Storage {
    pub fn new(path: &Path) -> Result<Self, String> {
        let c = Connection::open(path).map_err(|e| e.to_string())?;
        c.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, started INTEGER NOT NULL, data TEXT NOT NULL);").map_err(|e| e.to_string())?;
        let s = Self(Mutex::new(c));
        // An interrupted run is never presented as a live process after relaunch.
        for mut run in
            s.list::<Run>("SELECT data FROM runs WHERE json_extract(data, '$.status') = 'running'")?
        {
            if run.status == "running" {
                run.status = "interrupted".into();
                run.ended_at = Some(now());
                run.pid = None;
                run.ports.clear();
                s.save_run(&run)?;
            }
        }
        Ok(s)
    }
    pub fn projects(&self) -> Result<Vec<Project>, String> {
        self.list("SELECT data FROM projects ORDER BY rowid")
    }
    pub fn runs(&self) -> Result<Vec<Run>, String> {
        self.list("SELECT data FROM runs ORDER BY started DESC LIMIT 500")
    }
    fn list<T: serde::de::DeserializeOwned>(&self, sql: &str) -> Result<Vec<T>, String> {
        let c = self.0.lock().map_err(|e| e.to_string())?;
        let mut stmt = c.prepare(sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.map(|r| {
            serde_json::from_str(&r.map_err(|e| e.to_string())?).map_err(|e| e.to_string())
        })
        .collect()
    }
    pub fn save_project(&self, p: &Project) -> Result<(), String> {
        self.0.lock().map_err(|e| e.to_string())?.execute("INSERT INTO projects(id,data) VALUES (?1,?2) ON CONFLICT(id) DO UPDATE SET data=excluded.data", params![p.id, serde_json::to_string(p).map_err(|e| e.to_string())?]).map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn remove_project(&self, id: &str) -> Result<(), String> {
        self.0
            .lock()
            .map_err(|e| e.to_string())?
            .execute("DELETE FROM projects WHERE id=?1", [id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn save_run(&self, r: &Run) -> Result<(), String> {
        self.0.lock().map_err(|e| e.to_string())?.execute("INSERT INTO runs(id,started,data) VALUES (?1,?2,?3) ON CONFLICT(id) DO UPDATE SET data=excluded.data", params![r.id, r.started_at, serde_json::to_string(r).map_err(|e| e.to_string())?]).map_err(|e| e.to_string())?;
        Ok(())
    }
}
