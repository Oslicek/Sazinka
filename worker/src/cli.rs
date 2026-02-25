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
    /// Run database migrations and exit
    Migrate,
    /// Create or update an admin user interactively
    CreateAdmin {
        /// Admin email address
        #[arg(long)]
        email: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;

    #[test]
    fn test_cli_migrate_command_parses() {
        let cli = Cli::parse_from(["sazinka-worker", "migrate"]);
        assert!(matches!(cli.command, Some(Command::Migrate)));
    }

    #[test]
    fn test_cli_no_command_defaults_to_none() {
        let cli = Cli::parse_from(["sazinka-worker"]);
        assert!(cli.command.is_none());
    }

    #[test]
    fn test_cli_serve_command_parses() {
        let cli = Cli::parse_from(["sazinka-worker", "serve"]);
        assert!(matches!(cli.command, Some(Command::Serve)));
    }
}
