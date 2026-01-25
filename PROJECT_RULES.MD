# Project Rules

## Software Engineering Principles

### Test-Driven Development (TDD)
1. **Red**: Write a failing test first
2. **Green**: Write the minimum code to make the test pass
3. **Refactor**: Clean up the code while keeping tests green
4. **Commit**: Commit and push the code to GitHub
5. **Update PROJECT_CONTEXT**: Update PROJECT_CONTEXT file

### SOLID Principles
- **S**ingle Responsibility: Each module/function should have one reason to change
- **O**pen/Closed: Open for extension, closed for modification
- **L**iskov Substitution: Subtypes must be substitutable for their base types
- **I**nterface Segregation: Many specific interfaces over one general-purpose interface
- **D**ependency Inversion: Depend on abstractions, not concretions

### General Best Practices
- Keep functions small and focused (< 20 lines ideal)
- Meaningful naming over comments
- DRY (Don't Repeat Yourself) - but don't over-abstract prematurely
- YAGNI (You Aren't Gonna Need It) - implement only what's needed now
- Fail fast - validate inputs early, throw meaningful errors
- Prefer composition over inheritance
- Prefer pure functions where possible

---

## Architecture Principles

### Message-Driven Design
- All frontend-backend communication via NATS messages
- Request-reply pattern for synchronous operations
- Fire-and-forget for async operations (emails, background tasks)
- Idempotent message handlers (safe to replay)

### Separation of Concerns
```
┌─────────────────────┐
│   React Frontend    │  UI only, no business logic
└─────────────────────┘
          │
          ▼ (NATS messages)
┌─────────────────────┐
│    Rust Worker      │  Business logic + persistence
└─────────────────────┘
          │
          ▼ (SQL)
┌─────────────────────┐
│    PostgreSQL       │  Data storage
└─────────────────────┘
```

---

## TypeScript Conventions

### Naming
- `PascalCase`: Types, interfaces, classes, enums, React components
- `camelCase`: Variables, functions, parameters, properties
- `UPPER_SNAKE_CASE`: Constants, environment variables
- `IPascalCase` or `PascalCase`: Interfaces (be consistent)

### Code Style
- Use `const` by default, `let` when reassignment needed, never `var`
- Prefer `type` for unions/primitives, `interface` for object shapes
- Use explicit return types for public functions
- Prefer `unknown` over `any`, narrow types explicitly
- Use optional chaining (`?.`) and nullish coalescing (`??`)
- Prefer `readonly` for immutable properties
- Use discriminated unions for state management

### Functions
- Prefer arrow functions for callbacks and inline functions
- Use named function declarations for top-level functions
- Prefer async/await over raw Promises
- Avoid nested callbacks (callback hell)

### Error Handling
- Use specific error types or error codes
- Prefer Result types for expected failures (optional)
- Use try/catch for unexpected errors
- Always handle Promise rejections

---

## Rust Conventions

### Naming
- `PascalCase`: Types, traits, structs, enums
- `snake_case`: Functions, variables, modules, file names
- `SCREAMING_SNAKE_CASE`: Constants, statics
- `_prefix`: Unused variables (e.g., `_unused`)

### Code Style
- Prefer `Result<T, E>` over panics for recoverable errors
- Use `?` operator for error propagation
- Prefer `impl Trait` for return types when possible
- Use `#[derive(...)]` liberally (Clone, Debug, Serialize, Deserialize)
- Prefer iterators over manual loops
- Use `clippy` and fix all warnings

### Module Structure
```rust
// src/handlers/customer.rs

use crate::db::queries;
use crate::types::{Customer, CustomerRequest};

/// Handle customer.create message
pub async fn handle_create(
    msg: CustomerRequest,
    pool: &PgPool,
) -> Result<Customer, Error> {
    // Validate input
    msg.validate()?;
    
    // Business logic
    let customer = queries::create_customer(pool, &msg).await?;
    
    Ok(customer)
}
```

### Async Patterns
- Use `tokio` as async runtime
- Prefer `async-trait` for async trait methods
- Use `Arc<T>` for shared immutable state
- Avoid blocking operations in async contexts

### Error Handling
- Define domain-specific error enums with `thiserror`
- Use `anyhow` for application-level errors (main, handlers)
- Log errors with `tracing`, not `println!`

```rust
use thiserror::Error;

#[derive(Error, Debug)]
pub enum CustomerError {
    #[error("Customer not found: {0}")]
    NotFound(Uuid),
    
    #[error("Invalid email format")]
    InvalidEmail,
    
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
}
```

### Database (SQLx)
- Use compile-time checked queries with `sqlx::query!`
- Keep queries in dedicated modules (`db/queries/`)
- Use migrations for schema changes
- Prefer transactions for multi-step operations

```rust
// Compile-time checked query
let customer = sqlx::query_as!(
    Customer,
    r#"
    SELECT id, name, email, address, coordinates
    FROM customers
    WHERE id = $1 AND user_id = $2
    "#,
    customer_id,
    user_id
)
.fetch_optional(pool)
.await?;
```

---

## React Conventions

### Component Structure
```typescript
// 1. Imports
import { useState, useEffect } from 'react';

// 2. Types
interface Props {
  customerId: string;
}

// 3. Component
export function CustomerDetail({ customerId }: Props) {
  // 4. Hooks (custom hooks first)
  const { customer, isLoading } = useCustomer(customerId);
  const [isEditing, setIsEditing] = useState(false);
  
  // 5. Effects
  useEffect(() => {
    // ...
  }, [customerId]);
  
  // 6. Handlers
  const handleSave = () => {
    // ...
  };
  
  // 7. Render
  if (isLoading) return <Spinner />;
  return <div>{customer.name}</div>;
}
```

### Best Practices
- One component per file
- Use function components with hooks (no class components)
- Extract custom hooks for reusable logic (`use` prefix)
- Colocate related files (component, styles, tests)
- Prefer controlled components over uncontrolled
- Memoize expensive computations with `useMemo`
- Memoize callbacks with `useCallback` when passed to children

### State Management
- Use local state for UI-only concerns
- Lift state up when shared between siblings
- Use Zustand for global state (auth, connection status)
- NATS messages for server-synchronized state

---

## NATS Message Conventions

### Subject Naming
```
sazinka.<domain>.<action>
```

Examples:
- `sazinka.customer.create` - Create customer
- `sazinka.customer.list` - List customers
- `sazinka.route.plan` - Plan route optimization

### Message Payload Structure
```typescript
// Request
interface Request<T> {
  id: string;           // Correlation ID (UUID)
  timestamp: string;    // ISO 8601
  payload: T;
}

// Success Response
interface SuccessResponse<T> {
  id: string;
  timestamp: string;
  payload: T;
}

// Error Response
interface ErrorResponse {
  id: string;
  timestamp: string;
  error: {
    code: string;       // e.g., "CUSTOMER_NOT_FOUND"
    message: string;    // Human-readable
    details?: unknown;
  };
}
```

---

## Testing

### Framework
- **Vitest** for TypeScript unit tests
- **React Testing Library** for component tests
- **cargo test** for Rust unit tests

### TypeScript Tests
```typescript
// src/lib/geo.test.ts
import { describe, it, expect } from 'vitest';
import { haversineDistance } from './geo';

describe('haversineDistance', () => {
  it('should calculate distance between Prague and Brno', () => {
    const prague = { lat: 50.0755, lng: 14.4378 };
    const brno = { lat: 49.1951, lng: 16.6068 };
    
    const distance = haversineDistance(prague, brno);
    
    expect(distance).toBeCloseTo(185, 0); // ~185 km
  });
});
```

### Rust Tests
```rust
// src/services/geo.rs
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_haversine_distance() {
        let prague = Coordinates { lat: 50.0755, lng: 14.4378 };
        let brno = Coordinates { lat: 49.1951, lng: 16.6068 };
        
        let distance = haversine_distance(&prague, &brno);
        
        assert!((distance - 185.0).abs() < 1.0);
    }
}
```

### What to Test (TDD Focus)
- **VRPTW algorithm**: Optimization correctness
- **Distance calculations**: Haversine formula
- **Time window validation**: Constraint checking
- **Message handlers**: Request → response flow
- **TypeScript utilities**: Formatting, validation

### What NOT to Test
- Framework code (React, Tokio)
- Third-party libraries (NATS client, SQLx)
- Pure UI styling
- Implementation details

---

## Project Structure

```
sazinka/
├── apps/
│   └── web/                    # React frontend (Vite)
│       ├── src/
│       │   ├── components/     # React components
│       │   ├── hooks/          # Custom hooks
│       │   ├── stores/         # Zustand stores
│       │   ├── services/       # NATS, Nominatim clients
│       │   ├── routes/         # TanStack Router pages
│       │   ├── lib/            # Utilities
│       │   └── types/          # TypeScript types
│       ├── package.json
│       └── vite.config.ts
│
├── worker/                     # Rust backend
│   ├── src/
│   │   ├── main.rs
│   │   ├── config.rs
│   │   ├── handlers/           # NATS message handlers
│   │   ├── services/           # Business logic (VRPTW, geo)
│   │   ├── db/                 # Database queries
│   │   └── types/              # Rust types
│   ├── migrations/             # SQLx migrations
│   └── Cargo.toml
│
├── packages/
│   └── shared-types/           # Shared TypeScript types
│
├── infra/
│   ├── docker-compose.yml      # Local dev (NATS + PostgreSQL)
│   └── nats-server.conf
│
├── data/
│   └── sample/                 # Sample data for dev
│
├── package.json                # Workspace root
├── pnpm-workspace.yaml
├── turbo.json
├── PROJECT_CONTEXT.MD
└── PROJECT_RULES.MD
```

---

## Git Workflow

- Write meaningful commit messages
- Commit small, focused changes
- Keep `main` branch stable
- Use feature branches for new work
- Squash commits before merging when appropriate
- Update PROJECT_CONTEXT.MD after significant changes

---

## Code Review Checklist

### TypeScript
- [ ] Tests included and passing (TDD)
- [ ] No hardcoded values (use constants/config)
- [ ] Error handling appropriate
- [ ] No unused code or imports
- [ ] Naming is clear and consistent
- [ ] TypeScript strict mode satisfied

### Rust
- [ ] Tests included and passing
- [ ] `cargo clippy` passes without warnings
- [ ] `cargo fmt` applied
- [ ] Error types properly defined
- [ ] No unwrap() in production code (use ? or expect with message)
- [ ] Async code doesn't block

### General
- [ ] No security vulnerabilities
- [ ] Performance considerations addressed
- [ ] Documentation updated (if needed)
- [ ] NATS message schemas documented
