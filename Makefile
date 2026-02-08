# start docker stack with command "make dev"
dev:
	docker compose down
	docker compose up --build -d
	docker compose logs -f api

# stop docker stack with command "make down"
down:
	docker compose down

# view frontend (Vite) logs
frontend-logs:
	docker compose logs -f frontend

# build frontend for production (outputs to frontend/dist/)
build-frontend:
	docker compose run --rm frontend sh -c "npm install && npm run build"