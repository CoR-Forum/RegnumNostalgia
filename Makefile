# start docker stack with command "make dev"
dev:
	docker compose down
	docker compose up --build -d
	docker compose logs -f api

# stop docker stack with command "make down"
down:
	docker compose down