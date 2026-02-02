# start docker stack with command "make dev"
# command: docker compose down && docker compose up --build -d && docker compose logs -f php
dev:
	docker compose down
	docker compose up --build -d
	docker compose logs -f php

# stop docker stack with command "make down"
down:
	docker compose down