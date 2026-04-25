# Business Category Onboarding Plan

## Objective

Define a category-based onboarding model where **Maya is the central assistant** for each business, while enforcing strict data and knowledge isolation between categories.

---

## 1) Strict Category Separation

### YourColor (existing, independent category)

YourColor remains a standalone business/category with its own:

- custom apparel workflow
- pedidos
- recibos
- clientes
- finanzas
- equipo
- Maya knowledge and response style

### Construction/Roofing (new, fully separate category)

Construction/roofing must be configured independently with its own:

- business profile
- clients
- jobs
- finance records
- team members/crews
- Maya knowledge base and chat behavior

### Isolation rule (required)

No cross-category leakage is allowed:

- Maya for Construction must not use YourColor prices, policies, products, tone, or FAQs.
- Maya for YourColor must not use Construction services, estimates, labor rules, or materials.
- Data, prompts, and assistant memory scope must resolve to the **selected business only**.

---

## 2) Maya as the Center (all categories)

Maya is the core assistant in every category, but always scoped by business.

For Construction/Roofing, Maya should understand and assist with:

- roofing / techos
- plywood / playwood
- repairs
- house work
- remodeling
- estimates
- labor crews
- materials
- job scheduling
- customer follow-up

Behavior requirements:

- Load category-specific context from the active business only.
- Use category-specific language, services, and guardrails.
- Never blend mixed business context in one response.

---

## 3) Construction Dashboard Modules

When category = Construction/Roofing, show:

- Dashboard
- Chat IA / Maya
- Clientes
- Trabajos
- Equipo
- Finanzas
- Calendario
- Configuración

Module intent:

- **Trabajos** replaces product-order workflows with job lifecycle management.
- **Equipo** focuses on crew assignment, labor tracking, and availability.
- **Finanzas** supports estimate, deposit, stage payments, and job cost tracking.

---

## 4) Campañas IA Status

Keep **Campañas IA** visible in navigation, but mark as:

- **Próximamente** (preferred) or **Muy pronto**

Page message:

> “Campañas IA estará disponible pronto para ayudarte a conseguir más clientes y dar seguimiento automático.”

Important:

- Do not implement full campaign automation yet.
- Keep this as a roadmap/coming-soon module only.

---

## 5) Onboarding Questionnaire (per selected business)

During onboarding, capture and save these fields under the selected business only:

1. Nombre del negocio
2. Tipo de negocio
3. Servicios principales
4. Área de servicio
5. Cómo calcula estimados
6. Cómo cobra depósitos
7. Cómo agenda trabajos
8. Cómo maneja materiales
9. Cómo quiere que Maya hable con clientes
10. Qué cosas Maya no debe prometer

Data model guidance:

- Store answers in business-scoped settings/config docs.
- Version onboarding answers so future updates are trackable.
- Use these answers to build Maya system behavior for that business only.

---

## 6) Implementation Guardrails

- Category selector decides module set, wording, and Maya prompt templates.
- Business context resolver must always include `businessId` and `category`.
- Read/write operations for clients, jobs/orders, finance, and settings stay business-scoped.
- Any AI prompt assembly must pull only from active business documents.
- Validation checks should reject prompt/context merges from other businesses.

---

## 7) Rollout Plan (Recommended)

1. Add category metadata and onboarding schema by business.
2. Implement construction module visibility + route mapping.
3. Add construction-specific Maya prompt pack and constraints.
4. Add coming-soon state for Campañas IA.
5. QA with two businesses in parallel (YourColor + Construction) to confirm isolation.

Success criteria:

- Users can onboard a construction business without affecting YourColor.
- Maya responses differ correctly by category.
- No cross-category data appears in chat, dashboard, receipts, or finance views.

