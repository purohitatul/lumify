package io.lumify.web.routes.user;

import io.lumify.miniweb.HandlerChain;
import com.google.inject.Inject;
import io.lumify.core.config.Configuration;
import io.lumify.core.model.user.UserRepository;
import io.lumify.core.model.workspace.Workspace;
import io.lumify.core.model.workspace.WorkspaceRepository;
import io.lumify.core.user.User;
import io.lumify.web.BaseRequestHandler;
import org.json.JSONObject;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

public class UserGet extends BaseRequestHandler {
    @Inject
    public UserGet(
            final UserRepository userRepository,
            final WorkspaceRepository workspaceRepository,
            final Configuration configuration) {
        super(userRepository, workspaceRepository, configuration);
    }

    @Override
    public void handle(HttpServletRequest request, HttpServletResponse response, HandlerChain chain) throws Exception {
        String userName = getRequiredParameter(request, "user-name");

        User user = this.getUserRepository().findByUsername(userName);
        if (user == null) {
            respondWithNotFound(response);
            return;
        }

        JSONObject json = getUserRepository().toJsonWithAuths(user);

        Iterable<Workspace> workspaces = getWorkspaceRepository().findAll(user);
        json.put("workspaces", getWorkspaceRepository().toJson(workspaces, user, false));

        respondWithJson(response, json);
    }
}
