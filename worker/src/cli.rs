//! CLI argument parsing for the sazinka-worker binary.

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "sazinka-worker", about = "Sazinka CRM backend worker")]
pub struct Cli {
    #[command(subcommand)]
    pub command: Option<Command>,
}

#[derive(Subcommand)]
pub enum Command {
    /// Start the worker server (default if no subcommand given)
    Serve,
    /// Create or update an admin user interactively
    CreateAdmin {
        /// Admin email address
        #[arg(long)]
        email: String,
    },
}
