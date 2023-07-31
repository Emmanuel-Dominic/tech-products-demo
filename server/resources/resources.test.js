import { randomUUID } from "node:crypto";

import request from "supertest";

import app from "../app";
import { authenticateAs, patterns, sudoToken } from "../setupTests";

describe("/api/resources", () => {
	describe("POST /", () => {
		it("returns the created resource", async () => {
			const agent = await authenticateAs(
				{ id: 123, login: "foo-bar" },
				"foo@bar.org"
			);
			const resource = {
				title: "CYF Syllabus",
				url: "https://syllabus.codeyourfuture.io/",
			};

			const {
				body: { id },
			} = await agent
				.get("/api/auth/principal")
				.set("User-Agent", "supertest")
				.expect(200);
			const { body } = await agent
				.post("/api/resources")
				.send(resource)
				.set("User-Agent", "supertest")
				.expect(201);

			expect(body).toMatchObject({
				accession: expect.stringMatching(patterns.DATETIME),
				description: null,
				draft: true,
				id: expect.stringMatching(patterns.UUID),
				source: id,
				title: resource.title,
				url: resource.url,
			});
		});

		it("accepts a description", async () => {
			const agent = await authenticateAs(
				{ id: 123, login: "foo-bar" },
				"foo@bar.org"
			);
			const resource = {
				description: "Helpful tool for PostgreSQL DB migrations.",
				title: "Node PG Migrate",
				url: "https://salsita.github.io/node-pg-migrate/#/",
			};

			const { body } = await agent
				.post("/api/resources")
				.send(resource)
				.set("User-Agent", "supertest")
				.expect(201);

			expect(body).toMatchObject(resource);
		});

		it("allows a topic", async () => {
			const agent = await authenticateAs({ id: 0, name: "" }, "");
			const { body: topics } = await agent
				.get("/api/topics")
				.set("User-Agent", "supertest")
				.expect(200);
			const topic = topics.find(({ name }) => name === "React");

			const { body: created } = await agent
				.post("/api/resources")
				.send({
					title: "Something",
					topic: topic.id,
					url: "https://example.com",
				})
				.set("User-Agent", "supertest")
				.expect(201);

			expect(created).toHaveProperty("topic", topic.id);
		});

		it("rejects unknown topics", async () => {
			const agent = await authenticateAs({ id: 0, name: "" }, "");
			await agent
				.post("/api/resources")
				.send({
					title: "Something",
					topic: randomUUID(),
					url: "https://example.com",
				})
				.set("User-Agent", "supertest")
				.expect(400, { topic: '"topic" must exist' });
		});

		it("rejects unauthenticated users", async () => {
			await request(app)
				.post("/api/resources")
				.send({ title: "Something", url: "https://example.com" })
				.set("User-Agent", "supertest")
				.expect(401, "Unauthorized");
		});

		[
			{
				req: {},
				res: { title: '"title" is required', url: '"url" is required' },
				title: "everything missing",
			},
			{
				req: { url: "https://example.com" },
				res: { title: '"title" is required' },
				title: "missing title",
			},
			{
				req: { title: "foo" },
				res: { url: '"url" is required' },
				title: "missing url",
			},
			{
				req: { title: "foo", url: "/foo/bar" },
				res: { url: '"url" must be a valid uri' },
				title: "invalid url",
			},
		].forEach(({ req, res, title }) => {
			it(`rejects invalid request: ${title}`, async () => {
				const agent = await authenticateAs({ id: 0, login: "" }, "");
				await agent
					.post("/api/resources")
					.send(req)
					.set("User-Agent", "supertest")
					.expect(400, res);
			});
		});

		it("rejects duplicate resources", async () => {
			const agent = await authenticateAs({ id: 0, login: "" }, "");
			const title = "Wuthering Heights";
			const url = "https://example.com";
			await agent
				.post("/api/resources")
				.send({ title, url })
				.set("User-Agent", "supertest")
				.expect(201);
			await agent
				.post("/api/resources")
				.send({ title: "Other", url })
				.set("User-Agent", "supertest")
				.expect(409, "Conflict");
		});
	});

	describe("GET /", () => {
		it("allows superuser to see all resources", async () => {
			const agent = await authenticateAs({ id: 123, login: "" }, "");
			const resource = { title: "foo", url: "https://example.com" };
			await agent
				.post("/api/resources")
				.send(resource)
				.set("User-Agent", "supertest")
				.expect(201);

			const { body } = await request(app)
				.get("/api/resources")
				.query({ drafts: true })
				.set("Authorization", `Bearer ${sudoToken}`)
				.set("User-Agent", "supertest")
				.expect(200);

			expect(body).toHaveLength(1);
			expect(body[0]).toMatchObject(resource);
		});

		it("prevents non-superusers from seeing draft resources", async () => {
			const agent = await authenticateAs({ id: 123, login: "" }, "");
			const resource = { title: "title", url: "https://example.com" };
			await agent
				.post("/api/resources")
				.send(resource)
				.set("User-Agent", "supertest")
				.expect(201);

			await request(app)
				.get("/api/resources")
				.query({ drafts: true })
				.set("User-Agent", "supertest")
				.expect(200, []);
		});

		it("includes the topic name if present", async () => {
			const agent = await authenticateAs({ id: 0, name: "" }, "");
			const {
				body: [topic],
			} = await agent
				.get("/api/topics")
				.set("User-Agent", "supertest")
				.expect(200);

			await agent
				.post("/api/resources")
				.send({
					title: "Irrelevant",
					topic: topic.id,
					url: "https://example.com",
				})
				.set("User-Agent", "supertest")
				.expect(201);

			const {
				body: [draft],
			} = await request(app)
				.get("/api/resources")
				.query({ drafts: true })
				.set("Authorization", `Bearer ${sudoToken}`)
				.set("User-Agent", "supertest")
				.expect(200);
			expect(draft).toHaveProperty("topic_name", topic.name);
		});
	});

	describe("PATCH /:id", () => {
		it("allows superusers to publish a draft resource", async () => {
			const agent = await authenticateAs({ id: 123, login: "" }, "");
			const { body: resource } = await agent
				.post("/api/resources")
				.send({
					title: "CYF Syllabus",
					url: "https://syllabus.codeyourfuture.io/",
				})
				.set("User-Agent", "supertest")
				.expect(201);

			const { body: updated } = await request(app)
				.patch(`/api/resources/${resource.id}`)
				.send({ draft: false })
				.set("Authorization", `Bearer ${sudoToken}`)
				.set("User-Agent", "supertest")
				.expect(200);

			expect(updated).toEqual({
				...resource,
				draft: false,
				publication: expect.stringMatching(patterns.DATETIME),
			});

			const { body: resources } = await request(app)
				.get("/api/resources")
				.set("User-Agent", "supertest");
			expect(resources).toHaveLength(1);
		});

		it("rejects other changes", async () => {
			const agent = await authenticateAs({ id: 123, login: "" }, "");
			const { body: resource } = await agent
				.post("/api/resources")
				.send({
					title: "Mastering margin collapsing",
					url: "https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Box_Model/Mastering_margin_collapsing",
				})
				.set("User-Agent", "supertest")
				.expect(201);

			await request(app)
				.patch(`/api/resources/${resource.id}`)
				.send({ draft: true, title: "Something else" })
				.set("Authorization", `Bearer ${sudoToken}`)
				.set("User-Agent", "supertest")
				.expect(400, {
					draft: '"draft" must be [false]',
					title: '"title" is not allowed',
				});
		});

		it("handles missing resources", async () => {
			await request(app)
				.patch(`/api/resources/${randomUUID()}`)
				.send({ draft: false })
				.set("Authorization", `Bearer ${sudoToken}`)
				.set("User-Agent", "supertest")
				.expect(404);
		});

		it("prevents non-superusers from publishing resources", async () => {
			const agent = await authenticateAs({ id: 123, login: "" }, "");
			const { body: resource } = await agent
				.post("/api/resources")
				.send({
					title: "PostgreSQL tutorial",
					url: "https://www.postgresqltutorial.com/",
				})
				.set("User-Agent", "supertest")
				.expect(201);

			await request(app)
				.patch(`/api/resources/${resource.id}`)
				.send({ draft: false })
				.set("User-Agent", "supertest")
				.expect(401);
		});
	});
});
